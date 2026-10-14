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
import { OnlineHud, ResultsScreen, journalHtml, snapshotResult } from '../ui/hud';
import { PauseMenu } from '../ui/pause';
import { Toasts, type ToastKind } from '../ui/toasts';
import { net } from './net';
import type { GFMenuHooks } from '../ui/gunfightUi';
import type { OnlineGame } from './online';

export type AppMode = 'menu' | 'solo' | 'online' | 'inspection' | 'gunfight';

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
  /** position du joueur pour la carte (la sienne seulement) */
  playerPose(): { x: number; z: number; yaw: number } | null;
  /** fiche du personnage (exploration solo) pour l'écran de pause */
  soloCard(): string;
  /** mode Gunfight : écran du menu, salle ou combat en cours, fiche de pause, sortie */
  gunfight: GFMenuHooks;
  gfActive(): boolean;
  /** Gunfight : un panneau (équipement) a libéré la souris volontairement */
  gfBusy(): boolean;
  gfPauseCard(): string;
  quitGunfight(): void;
  /** téléportation (exploration solo) vers un point choisi sur la carte */
  teleport(x: number, z: number, underground: boolean, name: string): void;
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
      gunfight: {
        create: async (n, sx, st) => {
          await hooks.gunfight.create(n, sx, st);
          this.menu.show(false);
        },
        join: async (code, n, sx) => {
          await hooks.gunfight.join(code, n, sx);
          this.menu.show(false);
        },
        solo: async (n, sx, o) => {
          await hooks.gunfight.solo(n, sx, o);
          this.menu.show(false);
        },
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
    this.pause.onTeleport = (p) => {
      if (hooks.mode() !== 'solo' && hooks.mode() !== 'inspection') return;
      hooks.teleport(p.x, p.z, p.underground, p.name);
      this.toast(`Vous voici : ${p.name}.`, 'ok');
      this.setPause(false);
    };
    this.pause.onQuit = () => {
      this.setPause(false);
      if (hooks.mode() === 'online') this.quitOnline();
      else if (hooks.mode() === 'gunfight') {
        this.setPause(false);
        hooks.quitGunfight();
      } else this.backToMenu();
    };

    net.subscribe(() => this.render());
    net.onEvent = (e) => this.onEvent(e);
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerlockchange', () => this.onLockChange());
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
    const withMap = mode === 'solo' || mode === 'online' || mode === 'inspection' || mode === 'gunfight';
    if ((e.code === 'Escape' || e.code === 'KeyM') && withMap && !this.pause.open && !this.results.open && !document.pointerLockElement) {
      if (e.code === 'KeyM') this.pause.setTab('carte');
      this.setPause(true);
      e.preventDefault();
    } else if (e.code === 'KeyM' && this.pause.open) this.setPause(false);
    else if (e.code === 'KeyJ' && mode === 'online' && !this.pause.open) this.hud.toggleJournal();
  }

  /**
   * Échap avec la souris capturée : le navigateur libère la souris et garde la touche pour lui. On ouvre
   * donc l'écran de pause dès que la capture est perdue sans que le jeu l'ait demandé (une seule pression).
   */
  private selfUnlockAt = 0;
  private releasePointer() {
    this.selfUnlockAt = performance.now();
    document.exitPointerLock?.();
  }
  private onLockChange() {
    const mode = this.hooks.mode();
    if (document.pointerLockElement || this.pause.open || this.results.open || this.hooks.gfBusy()) return;
    if (performance.now() - this.selfUnlockAt < 400) return;
    if ((mode === 'solo' || mode === 'online' || mode === 'gunfight') && net.game?.phase !== 'reunion') this.setPause(true);
  }

  setPause(on: boolean) {
    if (on === this.pause.open) return;
    if (on) this.releasePointer();
    const online = this.hooks.mode() === 'online';
    if (on) this.refreshPauseSide();
    this.pause.show(on, online, { player: this.hooks.playerPose(), teleport: this.hooks.mode() === 'solo' || this.hooks.mode() === 'inspection', inspection: this.hooks.mode() === 'inspection' });
    this.hooks.setPaused(on);
  }

  /** Panneau de droite de l'écran de pause : rôle et journal (en ligne), personnage (solo). */
  private refreshPauseSide() {
    const G = net.game;
    if (this.hooks.mode() === 'gunfight') this.pause.setSide(this.hooks.gfPauseCard());
    else if (this.hooks.mode() === 'online' && G) this.pause.setSide(`${this.hud.roleCardHtml()}<div class="pause-journal">${journalHtml(G, net.secret)}</div>`);
    else this.pause.setSide(this.hooks.soloCard());
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
        this.releasePointer();
        this.setPause(false);
        this.results.show(snap);
      }
    }
    // réunion : la souris est libérée tout de suite pour voter (pas besoin d'appuyer sur Échap)
    if (G?.phase === 'reunion' && document.pointerLockElement) this.releasePointer();
    const inGame = !!L && !!G && (L.phase === 'partie' || L.phase === 'fin');
    if (inGame) this.hooks.enterOnline();
    else if (this.hooks.mode() === 'online') this.hooks.exitOnline();
    const lobbyOpen = !!L && L.phase === 'salon' && !this.results.open;
    this.lobby.el.classList.toggle('open', lobbyOpen);
    if (lobbyOpen) this.lobby.render(L!);
    if (L) this.menu.show(false);
    else if (this.hooks.mode() === 'menu' && !this.menu.open && !this.hooks.gfActive()) this.menu.show(true);
    if (this.pause.open && this.hooks.mode() === 'online') this.refreshPauseSide();
    const hudOpen = inGame && !this.results.open;
    this.hud.el.classList.toggle('open', hudOpen);
    if (hudOpen) this.hud.render(G!, net.secret, this.online?.prompts ?? []);
  }
}
