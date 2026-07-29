type AeroScenarioType = 'Cylinder' | 'Flat Plate' | 'Airfoil Wing' | 'Kelvin-Helmholtz' | 'Von Kármán Street';
class Noise {
  private seed: number;
  private p: Uint8Array;
  constructor(seed: number = Math.random()) {
    this.seed = seed;
    this.p = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = p[i & 255];
    }
  }
  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private lerp(t: number, a: number, b: number) {
    return a + t * (b - a);
    }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  public perlin2(x: number, y: number) {
    let X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x), v = this.fade(y);
    const A = this.p[X] + Y, B = this.p[X + 1] + Y;
    return this.lerp(v, 
      this.lerp(u, this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y)),
      this.lerp(u, this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1))
    );
  }
  public fbm2d(x: number, y: number, octaves: number = 4, persistence: number = 0.5): number {
    let total = 0;