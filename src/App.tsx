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
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for(let i = 0; i < octaves; i++) {
      total += this.perlin2(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxValue;
  }
}
import React, { useEffect, useRef, useState } from 'react';
type OrbitalScenarioType = 'Galaxy' | 'Binary Star';
type AeroBrushMode = 'Inject Fluid' | 'Draw Obstacle';
type ErosionBrushMode = 'Raise Terrain' | 'Lower Terrain';
type TerrainType = 'Volcanic Peak' | 'Fault Line Valley';
import { Wind, ThermometerSun, Waves, Settings, Activity, BookOpen, Calculator, ArrowDownCircle, Layers, Globe, Droplets, Cpu, Orbit } from 'lucide-react';
class FluidSolver {
  public N: number;
  private size: number;
  private dt: number;
  private diff: number;
  public visc: number;
  public s: Float32Array;
  public density: Float32Array;
  public Vx: Float32Array;
  public Vy: Float32Array;
  public Vx0: Float32Array;
  public Vy0: Float32Array;
  public p: Float32Array;
  public div: Float32Array;
  public obstacles: Uint8Array;
  constructor(N: number, diffusion: number, viscosity: number, dt: number) {
    this.N = N;
    this.size = (N + 2) * (N + 2);
    this.dt = dt;
    this.diff = diffusion;
    this.visc = viscosity;
    this.s = new Float32Array(this.size);
    this.density = new Float32Array(this.size);
    this.Vx = new Float32Array(this.size);
    this.Vy = new Float32Array(this.size);
    this.Vx0 = new Float32Array(this.size);
    this.Vy0 = new Float32Array(this.size);
    this.p = new Float32Array(this.size);
    this.div = new Float32Array(this.size);
    this.obstacles = new Uint8Array(this.size);
  }
  public IX(x: number, y: number): number {
    x = Math.max(0, Math.min(x, this.N + 1));
    y = Math.max(0, Math.min(y, this.N + 1));
    return x + y * (this.N + 2);
  }
  public addDensity(x: number, y: number, amount: number) {
    this.density[this.IX(x, y)] += amount;
  }
  public addVelocity(x: number, y: number, amountX: number, amountY: number) {
    const index = this.IX(x, y);
    this.Vx[index] += amountX;
    this.Vy[index] += amountY;
  }
  private setBnd(b: number, x: Float32Array) {
    const N = this.N;
    for (let i = 1; i <= N; i++) {
      x[this.IX(0, i)] = b === 1 ? -x[this.IX(1, i)] : x[this.IX(1, i)];
      x[this.IX(N + 1, i)] = b === 1 ? -x[this.IX(N, i)] : x[this.IX(N, i)];
      x[this.IX(i, 0)] = b === 2 ? -x[this.IX(i, 1)] : x[this.IX(i, 1)];
      x[this.IX(i, N + 1)] = b === 2 ? -x[this.IX(i, N)] : x[this.IX(i, N)];
    }
    x[this.IX(0, 0)] = 0.5 * (x[this.IX(1, 0)] + x[this.IX(0, 1)]);
    x[this.IX(0, N + 1)] = 0.5 * (x[this.IX(1, N + 1)] + x[this.IX(0, N)]);
    x[this.IX(N + 1, 0)] = 0.5 * (x[this.IX(N, 0)] + x[this.IX(N + 1, 1)]);
    x[this.IX(N + 1, N + 1)] = 0.5 * (x[this.IX(N, N + 1)] + x[this.IX(N + 1, N)]);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) {
          x[this.IX(i, j)] = 0;
        }
      }
       }
  }
  private linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number, iter: number = 20) {
    const N = this.N;
    const cRecip = 1.0 / c;
    for (let k = 0; k < iter; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          if (this.obstacles[this.IX(i, j)] === 0) {
            x[this.IX(i, j)] = (x0[this.IX(i, j)] + a * (x[this.IX(i + 1, j)] + x[this.IX(i - 1, j)] + x[this.IX(i, j + 1)] + x[this.IX(i, j - 1)])) * cRecip;
          }
        }
      }
      this.setBnd(b, x);
    }
  }
  private diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number) {
    const a = this.dt * diff * this.N * this.N;
    this.linSolve(b, x, x0, a, 1 + 4 * a);
  }
  private advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const N = this.N;
    let i0, j0, i1, j1;
    let x, y, s0, t0, s1, t1;
    let dt0 = dt * N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) continue;
        x = i - dt0 * u[this.IX(i, j)];
        y = j - dt0 * v[this.IX(i, j)];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        i0 = Math.floor(x);
        i1 = i0 + 1;
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
        j0 = Math.floor(y);
        j1 = j0 + 1;
        s1 = x - i0;
        s0 = 1.0 - s1;
        t1 = y - j0;
        t0 = 1.0 - t1;
        d[this.IX(i, j)] = 
          s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j1)]) +
          s1 * (t0 * d0[this.IX(i1, j0)] + t1 * d0[this.IX(i1, j1)]);
      }
    }
    this.setBnd(b, d);
  }
  private project(u: Float32Array, v: Float32Array, p: Float32Array, div: Float32Array) {
    const N = this.N;
    const h = 1.0 / N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) {
          div[this.IX(i, j)] = 0;
          p[this.IX(i, j)] = 0;
        } else {
          div[this.IX(i, j)] = -0.5 * h * (u[this.IX(i + 1, j)] - u[this.IX(i - 1, j)] + v[this.IX(i, j + 1)] - v[this.IX(i, j - 1)]);
          p[this.IX(i, j)] = 0;
           }
      }
    }
    this.setBnd(0, div);
    this.setBnd(0, p);
    this.linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 0) {
          u[this.IX(i, j)] -= 0.5 * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]) / h;
          v[this.IX(i, j)] -= 0.5 * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]) / h;
        }
      }
    }
    this.setBnd(1, u);
    this.setBnd(2, v);
  }
  public step() {
    this.diffuse(1, this.Vx0, this.Vx, this.visc, this.dt);
    this.diffuse(2, this.Vy0, this.Vy, this.visc, this.dt);
    this.project(this.Vx0, this.Vy0, this.p, this.div);
    this.advect(1, this.Vx, this.Vx0, this.Vx0, this.Vy0, this.dt);
    this.advect(2, this.Vy, this.Vy0, this.Vx0, this.Vy0, this.dt);
    this.project(this.Vx, this.Vy, this.p, this.div);
    this.diffuse(0, this.s, this.density, this.diff, this.dt);
    this.advect(0, this.density, this.s, this.Vx, this.Vy, this.dt);
    for(let i = 0; i < this.density.length; i++) {
      this.density[i] *= 0.99;
    }
  }
}
class ConvectionSolver {
  public N: number;
  private size: number;
  private dt: number;
  private diff: number;
  public visc: number;
  public T: Float32Array;
  public T0: Float32Array;
  public Vx: Float32Array;
  public Vy: Float32Array;
  public Vx0: Float32Array;
  public Vy0: Float32Array;
  public p: Float32Array;
  public div: Float32Array;
  public ambientT: number = 0;
  public coriolisF: number = 0;
  public beta: number = 0.05;
  constructor(N: number, diffusion: number, viscosity: number, dt: number) {
    this.N = N;
    this.size = (N + 2) * (N + 2);
    this.dt = dt;
    this.diff = diffusion;
    this.visc = viscosity;
    this.T = new Float32Array(this.size);
    this.T0 = new Float32Array(this.size);
    this.Vx = new Float32Array(this.size);
    this.Vy = new Float32Array(this.size);
    this.Vx0 = new Float32Array(this.size);
    this.Vy0 = new Float32Array(this.size);
    this.p = new Float32Array(this.size);
    this.div = new Float32Array(this.size);
  }
  public IX(x: number, y: number): number {
    x = Math.max(0, Math.min(x, this.N + 1));
    y = Math.max(0, Math.min(y, this.N + 1));
    return x + y * (this.N + 2);
  }
  public addTemperature(x: number, y: number, amount: number) {
    this.T[this.IX(x, y)] += amount;
  }
  private setBnd(b: number, x: Float32Array) {
    const N = this.N;
    for (let i = 1; i <= N; i++) {
      x[this.IX(0, i)] = b === 1 ? -x[this.IX(1, i)] : x[this.IX(1, i)];
      x[this.IX(N + 1, i)] = b === 1 ? -x[this.IX(N, i)] : x[this.IX(N, i)];
      x[this.IX(i, 0)] = b === 2 ? -x[this.IX(i, 1)] : x[this.IX(i, 1)];
      x[this.IX(i, N + 1)] = b === 2 ? -x[this.IX(i, N)] : x[this.IX(i, N)];
    }
    x[this.IX(0, 0)] = 0.5 * (x[this.IX(1, 0)] + x[this.IX(0, 1)]);
    x[this.IX(0, N + 1)] = 0.5 * (x[this.IX(1, N + 1)] + x[this.IX(0, N)]);
    x[this.IX(N + 1, 0)] = 0.5 * (x[this.IX(N, 0)] + x[this.IX(N + 1, 1)]);
    x[this.IX(N + 1, N + 1)] = 0.5 * (x[this.IX(N, N + 1)] + x[this.IX(N + 1, N)]);
  }
  private linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number) {
    const N = this.N;
    const cRecip = 1.0 / c;
    for (let k = 0; k < 20; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          x[this.IX(i, j)] = (x0[this.IX(i, j)] + a * (x[this.IX(i + 1, j)] + x[this.IX(i - 1, j)] + x[this.IX(i, j + 1)] + x[this.IX(i, j - 1)])) * cRecip;
        }
      }
      this.setBnd(b, x);
    }
  }
  private diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number) {
    const a = this.dt * diff * this.N * this.N;
    this.linSolve(b, x, x0, a, 1 + 4 * a);
  }