/**
 * Chef d'orchestre de l'interface : décide quel écran est visible (menu principal, salon, partie en ligne,
 * pause, résultats) à partir de l'état reçu du serveur et du mode de jeu, et relaie les événements de la
 * partie (notifications, sons). Les écrans eux-mêmes sont dans `src/ui/`.
 */
import type { Sex } from '../characters/catalog';
import type { GameEvent } from '../shared/protocol';
import { sfx } from '../audio/sfx';
import { MainMenu } from '../ui/menu';
import { LobbyScreen } from '../ui/lobby';
import { OnlineHud, ResultsScreen, snapshotResult } from '../ui/hud';
import { PauseMenu } from '../ui/pause';
import { Toasts, type ToastKind } from '../ui/toasts';
import { net } from './net';
import type { OnlineGame } from './online';

export type AppMode = 'menu' | 'solo' | 'online' | 'inspection';

export interface UiHooks {
  mode(): AppMode;
  /** exploration solo (village, personnages non joueurs) */
  solo(sex: Sex): Promise<void>;
  /** la partie en ligne commence (ou reprend après reconnexion) */
  enterOnline(): void;
  /** la partie en ligne n'est plus affichée : retour à la scène du menu */
  exitOnline(): void;
  /** menu principal (scène cinématique) */
  toMenu(): void;
  inspect(): void;
  /** gel des commandes du personnage (pause) */
  setPaused(on: boolean): void;
}

export class GameUi {
  readonly menu: MainMenu;
  readonly lobby: LobbyScreen;
  readonly hud = new OnlineHud();
  readonly results = new ResultsScreen();
  readonly pause = new PauseMenu();
  readonly toasts = new Toasts();
  private online: OnlineGame | null = null;

  constructor(private hooks: UiHooks) {
    this.menu = new MainMenu({
      create: (name, sex, comp) => net.create(name, sex, comp),
      join: (code, name, sex) => net.join(code, name, sex),
      solo: async (sex) => {
        await hooks.solo(sex);
        this.menu.show(false);
      },
      inspect: () => {
        this.menu.show(false);
        hooks.inspect();
      },
    });
    this.lobby = new LobbyScreen({ quit: () => this.quitOnline(), toast: (t, k) => this.toast(t, k) });
    document.body.append(this.menu.el, this.lobby.el, this.hud.el, this.results.el, this.pause.el);

    this.hud.onVote = (target) => net.vote(target).catch((e: Error) => this.toast(e.message, 'bad'));
    this.hud.onPause = () => this.setPause(true);
    this.results.onBack = () => {
      sfx.click();
      this.results.close();
      if (net.lobby?.phase === 'fin') net.backToLobby().catch((e: Error) => this.toast(e.message, 'bad'));
      this.render();
    };
    this.results.onQuit = () => {
      this.results.close();
      this.quitOnline();
    };
    this.pause.onResume = () => this.setPause(false);
    this.pause.onQuit = () => {
      this.setPause(false);
      if (hooks.mode() === 'online') this.quitOnline();
      else this.backToMenu();
    };

    net.subscribe(() => this.render());
    net.onEvent = (e) => this.onEvent(e);
    window.addEventListener('keydown', (e) => this.onKey(e));
    net.connect();
  }

  attach(online: OnlineGame) {
    this.online = online;
    online.onFeedback = (t, kind) => this.toast(t, kind ?? 'info');
    net.onGesture = (g) => online.onGesture(g);
  }

  toast(text: string, kind: ToastKind = 'info') {
    this.toasts.push(text, kind);
  }

  showMenu(on: boolean) {
    this.menu.show(on);
  }

  private onEvent(e: GameEvent) {
    const kind: ToastKind = e.kind === 'fin' ? 'info' : e.kind;
    this.toast(e.text, kind);
    // la détonation de son propre tir est déjà jouée au clic
    if (e.kind === 'tir' && !this.online?.justShot) sfx.gunshot();
    if (e.kind === 'reunion') sfx.bell();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const mode = this.hooks.mode();
    const inGame = mode === 'solo' || mode === 'online';
    if (e.code === 'Escape' && inGame && !this.pause.open && !this.results.open && !document.pointerLockElement) {
      this.setPause(true);
      e.preventDefault();
    } else if (e.code === 'KeyJ' && mode === 'online' && !this.pause.open) this.hud.toggleJournal();
  }

  setPause(on: boolean) {
    if (on === this.pause.open) return;
    if (on) document.exitPointerLock?.();
    this.pause.show(on, this.hooks.mode() === 'online');
    this.hooks.setPaused(on);
  }

  /** Quitte le salon ou la partie en ligne et revient au menu principal. */
  quitOnline() {
    net.leave();
    this.results.close();
    this.hooks.exitOnline();
    this.backToMenu();
  }

  backToMenu() {
    this.setPause(false);
    this.hooks.toMenu();
    this.menu.show(true);
    this.render();
  }

  /** Rafraîchit tous les écrans à partir de l'état reçu du serveur (appelé à chaque message et 4 fois par seconde). */
  render() {
    const L = net.lobby;
    const G = net.game;
    // résultats : figés à la fin de la partie, visibles jusqu'à ce que le joueur les ferme
    if (G?.result && this.results.shown !== G.startedAt) {
      const snap = snapshotResult(G);
      if (snap) {
        document.exitPointerLock?.();
        this.setPause(false);
        this.results.show(snap);
      }
    }
    // réunion : la souris est libérée tout de suite pour voter (pas besoin d'appuyer sur Échap)
    if (G?.phase === 'reunion' && document.pointerLockElement) document.exitPointerLock();
    const inGame = !!L && !!G && (L.phase === 'partie' || L.phase === 'fin');
    if (inGame) this.hooks.enterOnline();
    else if (this.hooks.mode() === 'online') this.hooks.exitOnline();
    const lobbyOpen = !!L && L.phase === 'salon' && !this.results.open;
    this.lobby.el.classList.toggle('open', lobbyOpen);
    if (lobbyOpen) this.lobby.render(L!);
    if (L) this.menu.show(false);
    else if (this.hooks.mode() === 'menu' && !this.menu.open) this.menu.show(true);
    const hudOpen = inGame && !this.results.open;
    this.hud.el.classList.toggle('open', hudOpen);
    if (hudOpen) this.hud.render(G!, net.secret, this.online?.prompts ?? []);
  }
}
