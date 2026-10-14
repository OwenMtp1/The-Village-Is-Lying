/**
 * Chef d'orchestre du mode Gunfight : crée la connexion (en ligne ou solo), affiche la salle d'attente, l'interface
 * de combat et les résultats selon l'état reçu, et fait le lien avec la scène (`GunfightGame`).
 */
import type { Sex } from '../characters/catalog';
import type { GFSettings, Team } from '../shared/gunfight';
import { GFHud, GFLobbyScreen, GFResults, scoreboard } from '../ui/gunfightUi';
import type { Toasts } from '../ui/toasts';
import { sfx } from '../audio/sfx';
import { GFClient, LocalGF, SocketGF } from './gfNet';
import type { GunfightGame } from './gunfight';

export interface GFCtlHooks {
  /** la partie commence (ou recommence) : scène et caméra du combat */
  enter(): void;
  /** retour à la scène du menu (salle d'attente ou menu principal) */
  exit(): void;
  /** fin complète : retour au menu principal */
  toMenu(): void;
  sight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean;
  /** point dans le décor (rebonds des grenades en solo) */
  solid(x: number, y: number, z: number): boolean;
}

export class GunfightController {
  client: GFClient | null = null;
  readonly lobby: GFLobbyScreen;
  readonly hud = new GFHud();
  readonly results = new GFResults();
  private key = '';
  private off: (() => void) | null = null;

  constructor(
    private game: GunfightGame,
    private toasts: Toasts,
    private hooks: GFCtlHooks,
  ) {
    this.lobby = new GFLobbyScreen({
      me: () => this.client?.me ?? '',
      setSettings: (s) => this.client!.setSettings(s),
      setTeam: (t) => this.client!.setTeam(t),
      start: () => this.client!.start(),
      quit: () => this.quit(),
      toast: (t, k) => this.toasts.push(t, k ?? 'info'),
    });
    document.body.append(this.lobby.el, this.hud.el, this.results.el);
    this.hud.names = (id) => this.client?.nameOf(id) ?? '?';
    game.onHitMarker = (k, head) => this.hud.hitMarker(k, head);
    game.onDamaged = () => this.hud.damaged();
    // équipement (touche B, bouton de l'écran d'élimination) : la souris est libérée pendant le choix
    const kit = (open?: boolean) => {
      const G = this.client?.game;
      if (G) this.hud.toggleKit(G, this.client!.me, open);
    };
    game.onLoadout = () => kit();
    this.hud.onKitRequest = () => kit(true);
    this.hud.onKitClose = () => kit(false);
    this.hud.onKitOpen = (open) => {
      game.kitOpen = open;
      if (open) document.exitPointerLock?.();
    };
    this.hud.onKit = (l) =>
      this.client
        ?.setLoadout(l)
        .then(() => {
          const G = this.client?.game;
          if (G) this.hud.renderKit(G, this.client!.me);
        })
        .catch((e: Error) => this.toasts.push(e.message, 'bad'));
    this.results.onBack = () => {
      sfx.click();
      this.results.close();
      this.client?.backToLobby().catch((e: Error) => this.toasts.push(e.message, 'bad'));
      this.render();
    };
    this.results.onQuit = () => this.quit();
    setInterval(() => this.client?.game && this.render(), 200);
  }

  get active() {
    return !!this.client;
  }

  private use(c: GFClient) {
    this.off?.();
    this.client = c;
    this.game.attach(c);
    this.key = '';
    c.onEvent = (e) => {
      if (e.to && e.to !== c.me) return;
      this.toasts.push(e.text, e.kind === 'mort' ? 'mort' : 'info');
    };
    this.off = c.subscribe(() => this.render());
    this.render();
  }

  async create(name: string, sex: Sex, settings: GFSettings) {
    const c = new SocketGF();
    try {
      await c.create(name, sex, settings);
    } catch (e) {
      c.leave();
      throw e;
    }
    this.use(c);
  }
  async join(code: string, name: string, sex: Sex) {
    const c = new SocketGF();
    try {
      await c.join(code, name, sex);
    } catch (e) {
      c.leave();
      throw e;
    }
    this.use(c);
  }
  async solo(name: string, sex: Sex, opts: { settings: GFSettings; bots: number; difficulty: 'facile' | 'normal' | 'difficile'; team: Team }) {
    this.use(new LocalGF(name, sex, opts, (a, b) => this.hooks.sight(a, b), (x, y, z) => this.hooks.solid(x, y, z)));
  }

  quit() {
    sfx.back();
    this.client?.leave();
    this.off?.();
    this.off = null;
    this.client = null;
    this.key = '';
    this.game.dispose();
    this.results.close();
    this.lobby.el.classList.remove('open');
    this.hud.el.classList.remove('open');
    this.hooks.toMenu();
  }

  /** Fiche pour l'écran de pause : tableau des scores. */
  pauseCard() {
    const G = this.client?.game;
    if (!G) return '';
    return `<div class="pause-journal gf-pause"><h3>Scores</h3>${scoreboard(G, this.client!.me, (id) => this.client!.nameOf(id))}</div>`;
  }

  /** À chaque image : mini-carte et avertissement de limite (le reste de l'interface suit `render`). */
  frame() {
    const c = this.client;
    const p = this.game.player;
    if (!c?.game || !this.hud.el.classList.contains('open')) return;
    const me = p && this.game.alive ? { x: p.controller.x, z: p.controller.z, yaw: this.game.cam.yaw } : null;
    this.hud.minimap.render(this.game.map, me, this.game.miniDots());
    this.hud.outOfMap(this.game.atLimit > 0);
    const g = this.game;
    this.hud.stance(!g.alive ? null : g.cover ? (g.cover.low ? 'À couvert (bas) · viser pour se relever · Q pour quitter' : 'À couvert · Q pour quitter') : g.crouch ? 'Accroupi · C pour se relever' : null);
  }

  render() {
    const c = this.client;
    if (!c) return;
    const L = c.lobby;
    const G = c.game;
    if (G?.result && this.results.shown !== G.startedAt) {
      document.exitPointerLock?.();
      this.results.show(G, c.me, (id) => c.nameOf(id), c.local);
    }
    const inGame = !!G && !!L && L.phase !== 'salon';
    if (inGame) {
      const key = `${G!.startedAt}`;
      if (key !== this.key) {
        this.key = key;
        this.game.dispose();
        this.game.attach(c);
        this.game.ensure().catch((e: Error) => this.toasts.push(`Personnages non chargés : ${e.message}`, 'bad'));
        this.hooks.enter();
      }
    } else if (this.key) {
      this.key = '';
      this.game.dispose();
      this.game.attach(c);
      this.hooks.exit();
    }
    const lobbyOpen = !!L && L.phase === 'salon' && !this.results.open && !c.local;
    this.lobby.el.classList.toggle('open', lobbyOpen);
    if (lobbyOpen) this.lobby.render(L!);
    const hudOpen = inGame && !this.results.open;
    this.hud.el.classList.toggle('open', hudOpen);
    if (hudOpen) this.hud.render(G!, c.me, c.serverNow(), this.game.item, this.game.spreadPx(), this.game.scoped);
  }
}
