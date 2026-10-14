/**
 * Gestionnaire unique des entrées (clavier, souris, verrouillage du pointeur) : un seul ensemble d'écouteurs
 * pour toute l'application ; la visionneuse d'inspection et le jeu lisent le même état.
 * Les touches sont repérées par leur position physique (`code`) : ZQSD sur AZERTY = WASD sur QWERTY.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouse = { dx: 0, dy: 0, wheel: 0 };
  private dragging = false;

  constructor(readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointerdown', (e) => {
      // clic gauche avec la souris capturée : action (coup de couteau, tir) ; le premier clic sert à capturer
      if (this.locked && e.button === 0) this.pressed.add('Mouse0');
      this.dragging = true;
      target.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    target.addEventListener(
      'wheel',
      (e) => {
        this.mouse.wheel += e.deltaY;
      },
      { passive: true },
    );
  }

  /** Touche maintenue. */
  held(code: string) {
    return this.down.has(code);
  }

  /** Touche enfoncée depuis la dernière lecture (front montant, jamais répété en maintien). */
  consume(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** Déplacement de la souris et de la molette depuis la dernière lecture. */
  takeMouse() {
    const m = { ...this.mouse };
    this.mouse = { dx: 0, dy: 0, wheel: 0 };
    return m;
  }

  /** Oublie les fronts non lus (changement de mode). */
  flush() {
    this.pressed.clear();
    this.takeMouse();
  }

  get locked() {
    return document.pointerLockElement === this.target;
  }

  lock() {
    if (!this.locked) (this.target.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {});
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }
}
