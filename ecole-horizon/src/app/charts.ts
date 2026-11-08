import { Component, computed, input, signal } from '@angular/core';

export interface Serie { name: string; values: (number | null)[]; color?: string; }

const W = 640;
const DEFAULT_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

function niceStep(max: number): number {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}
const rtop = (x: number, y: number, w: number, h: number, r: number): string => {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const rright = (x: number, y: number, w: number, h: number, r: number): string => {
  r = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
};

interface Bar { path: string; color: string; si: number; i: number; }

@Component({
  selector: 'app-chart',
  template: `
  <figure class="chart">
    @if (series().length > 1) {
      <div class="legend">@for (s of series(); track s.name; let k = $index) { <span><i [style.background]="colorOf(k)"></i>{{ s.name }}</span> }</div>
    }
    @if (empty()) {
      <p class="muted small nodata">Pas encore de données pour ce graphique.</p>
    } @else if (table()) {
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th>@for (s of series(); track s.name) { <th class="right">{{ s.name }}</th> }</tr></thead>
        <tbody>@for (l of labels(); track $index; let i = $index) { <tr><td>{{ l }}</td>@for (s of series(); track s.name) { <td class="right num">{{ val(s.values[i]) }}</td> }</tr> }</tbody>
      </table></div>
    } @else {
      <div class="plot" (mouseleave)="hover.set(null)">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + geo().H" role="img" [attr.aria-label]="label()" preserveAspectRatio="xMidYMid meet">
          @for (t of geo().ticks; track t.v) {
            @if (hor()) {
              <line [attr.x1]="t.p" [attr.x2]="t.p" [attr.y1]="geo().mt" [attr.y2]="geo().H - geo().mb" class="grid" />
              <text [attr.x]="t.p" [attr.y]="geo().H - 6" text-anchor="middle" class="ax">{{ fmt()(t.v) }}</text>
            } @else {
              <line [attr.x1]="geo().ml" [attr.x2]="W - geo().mr" [attr.y1]="t.p" [attr.y2]="t.p" class="grid" />
              <text [attr.x]="geo().ml - 6" [attr.y]="t.p + 4" text-anchor="end" class="ax">{{ fmt()(t.v) }}</text>
            }
          }
          @if (refLine() !== null) {
            @if (hor()) { <line [attr.x1]="geo().ref" [attr.x2]="geo().ref" [attr.y1]="geo().mt" [attr.y2]="geo().H - geo().mb" class="ref" /> }
            @else { <line [attr.x1]="geo().ml" [attr.x2]="W - geo().mr" [attr.y1]="geo().ref" [attr.y2]="geo().ref" class="ref" /> }
          }
          @if (hover() !== null && type() === 'line') {
            <line [attr.x1]="geo().cx[hover()!]" [attr.x2]="geo().cx[hover()!]" [attr.y1]="geo().mt" [attr.y2]="geo().H - geo().mb" class="cross" />
          }
          @for (b of bars(); track $index) {
            <path [attr.d]="b.path" [attr.fill]="colorOf(b.si)" class="bar" [class.dim]="hover() !== null && hover() !== b.i" />
          }
          @for (p of paths(); track p.si) {
            <path [attr.d]="p.d" fill="none" [attr.stroke]="colorOf(p.si)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />
          }
          @for (d of dots(); track $index) {
            <circle [attr.cx]="d.x" [attr.cy]="d.y" [attr.r]="d.big ? 5 : 3.5" [attr.fill]="colorOf(d.si)" class="dot" />
          }
          @for (t of valueTexts(); track $index) {
            <text [attr.x]="t.x" [attr.y]="t.y" [attr.text-anchor]="t.anchor" class="val">{{ t.text }}</text>
          }
          @for (l of xLabels(); track $index) {
            @if (hor()) { <text [attr.x]="geo().ml - 8" [attr.y]="l.p + 4" text-anchor="end" class="ax lab">{{ l.text }}<title>{{ l.full }}</title></text> }
            @else { <text [attr.x]="l.p" [attr.y]="geo().H - 10" text-anchor="middle" class="ax lab">{{ l.text }}<title>{{ l.full }}</title></text> }
          }
          @for (c of geo().cx; track $index; let i = $index) {
            @if (hor()) {
              <rect [attr.x]="0" [attr.y]="geo().cy[i] - geo().band / 2" [attr.width]="W" [attr.height]="geo().band" fill="transparent" (mouseenter)="hover.set(i)" (mousemove)="hover.set(i)" (click)="hover.set(i)" />
            } @else {
              <rect [attr.x]="c - geo().band / 2" [attr.y]="0" [attr.width]="geo().band" [attr.height]="geo().H" fill="transparent" (mouseenter)="hover.set(i)" (mousemove)="hover.set(i)" (click)="hover.set(i)" />
            }
          }
        </svg>
        @if (hover() !== null) {
          <div class="tip" [class.left]="tipSide() === 'l'" [class.right]="tipSide() === 'r'" [style.left.%]="tipX()" [style.top.%]="tipY()">
            <b>{{ labels()[hover()!] }}</b>
            @for (s of series(); track s.name; let k = $index) {
              @if (s.values[hover()!] !== null && s.values[hover()!] !== undefined) { <div><i [style.background]="colorOf(k)"></i>{{ series().length > 1 ? s.name + ' : ' : '' }}<span class="num">{{ val(s.values[hover()!]) }}</span></div> }
            }
          </div>
        }
      </div>
    }
    @if (!empty()) { <button type="button" class="link tiny" (click)="table.set(!table())">{{ table() ? 'Voir le graphique' : 'Voir en tableau' }}</button> }
  </figure>`,
  styles: `
    :host { display: block; }
    .chart { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--muted); }
    .legend span, .tip div { display: inline-flex; align-items: center; gap: 6px; }
    .legend i, .tip i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .ref { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; opacity: .7; }
    .cross { stroke: var(--muted); stroke-width: 1; opacity: .5; }
    .ax { fill: var(--muted); font-size: 13px; font-family: var(--font-body, inherit); }
    .val { fill: var(--text, currentColor); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .bar { stroke: var(--surface); stroke-width: 1.5; transition: opacity .12s; }
    .bar.dim { opacity: .45; }
    .dot { stroke: var(--surface); stroke-width: 2; }
    .tip { position: absolute; transform: translate(-50%, -105%); background: var(--surface); color: var(--text, inherit); border: 1px solid var(--line); border-radius: 10px; padding: 7px 10px; font-size: 12.5px; box-shadow: 0 8px 22px -8px rgb(0 0 0 / .35); pointer-events: none; display: flex; flex-direction: column; gap: 3px; z-index: 3; white-space: nowrap; }
    .tip.left { transform: translate(0, -105%); }
    .tip.right { transform: translate(-100%, -105%); }
    .nodata { padding: 28px 0; text-align: center; }
    .tbl-wrap { max-height: 280px; overflow: auto; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .tbl th, .tbl td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: start; }
    .tbl th.right, .tbl td.right { text-align: end; }
    .link { align-self: flex-start; }
  `,
})
export class Chart {
  readonly W = W;
  readonly type = input<'bar' | 'hbar' | 'line'>('bar');
  readonly labels = input<string[]>([]);
  readonly series = input<Serie[]>([]);
  readonly stacked = input(false);
  readonly height = input(250);
  readonly yMax = input<number | undefined>(undefined);
  readonly refLine = input<number | null>(null);
  readonly fmt = input<(n: number) => string>((n) => String(Math.round(n * 100) / 100));
  readonly tipFmt = input<((n: number) => string) | undefined>(undefined);
  readonly showValues = input<boolean | undefined>(undefined);
  readonly label = input('Graphique');

  readonly hover = signal<number | null>(null);
  readonly table = signal(false);

  readonly hor = computed(() => this.type() === 'hbar');
  colorOf(k: number): string { return this.series()[k]?.color ?? DEFAULT_COLORS[k % DEFAULT_COLORS.length]; }
  val(v: number | null | undefined): string { return v === null || v === undefined ? '—' : (this.tipFmt() ?? this.fmt())(v); }

  readonly empty = computed(() => !this.labels().length || this.series().every((s) => s.values.every((v) => v === null || v === undefined)));

  readonly geo = computed(() => {
    const n = this.labels().length || 1;
    const ns = this.series().length || 1;
    const hor = this.hor();
    const ml = hor ? 104 : 44, mr = hor ? 40 : 14, mt = 12, mb = hor ? 24 : 32;
    const H = hor ? Math.max(130, n * (this.stacked() ? 26 : 14 + ns * 14) + mt + mb) : this.height();
    const pw = W - ml - mr, ph = H - mt - mb;
    let dmax = 0;
    for (let i = 0; i < n; i++) {
      if (this.stacked()) dmax = Math.max(dmax, this.series().reduce((a, s) => a + (s.values[i] ?? 0), 0));
      else for (const s of this.series()) dmax = Math.max(dmax, s.values[i] ?? 0);
    }
    const fixed = this.yMax();
    const step = fixed ? fixed / 4 : niceStep(dmax || 1);
    const max = fixed ?? step * 4;
    const ticks: { v: number; p: number }[] = [];
    for (let v = 0; v <= max + step / 1000; v += step) ticks.push({ v, p: hor ? ml + (v / max) * pw : mt + ph - (v / max) * ph });
    const band = (hor ? ph : pw) / n;
    const cx: number[] = [], cy: number[] = [];
    for (let i = 0; i < n; i++) {
      if (hor) { cx.push(ml); cy.push(mt + band * (i + 0.5)); } else { cx.push(ml + band * (i + 0.5)); cy.push(mt + ph / 2); }
    }
    const rl = this.refLine();
    const ref = rl === null ? 0 : hor ? ml + (rl / max) * pw : mt + ph - (rl / max) * ph;
    return { H, ml, mr, mt, mb, pw, ph, max, step, ticks, band, cx, cy, ref };
  });

  private coordV(v: number): number { const g = this.geo(); return g.mt + g.ph - (v / g.max) * g.ph; }
  private coordH(v: number): number { const g = this.geo(); return g.ml + (v / g.max) * g.pw; }

  readonly bars = computed<Bar[]>(() => {
    if (this.type() === 'line') return [];
    const g = this.geo(), ser = this.series(), n = this.labels().length, ns = ser.length;
    const out: Bar[] = [];
    for (let i = 0; i < n; i++) {
      if (this.stacked()) {
        const bw = Math.min(this.hor() ? 18 : 38, g.band * 0.62);
        let acc = 0;
        const last = ser.reduce((a, s, k) => ((s.values[i] ?? 0) > 0 ? k : a), -1);
        ser.forEach((s, k) => {
          const v = s.values[i] ?? 0;
          if (v <= 0) return;
          if (this.hor()) {
            const x0 = this.coordH(acc), x1 = this.coordH(acc + v);
            out.push({ path: rright(x0, g.cy[i] - bw / 2, x1 - x0, bw, k === last ? 4 : 0), color: this.colorOf(k), si: k, i });
          } else {
            const y0 = this.coordV(acc), y1 = this.coordV(acc + v);
            out.push({ path: rtop(g.cx[i] - bw / 2, y1, bw, y0 - y1, k === last ? 4 : 0), color: this.colorOf(k), si: k, i });
          }
          acc += v;
        });
      } else {
        const bw = Math.min(this.hor() ? 18 : 34, (g.band * 0.74) / ns - 2);
        const total = bw * ns + 2 * (ns - 1);
        ser.forEach((s, k) => {
          const v = s.values[i];
          if (v === null || v === undefined || v <= 0) return;
          const off = -total / 2 + k * (bw + 2);
          if (this.hor()) out.push({ path: rright(g.ml, g.cy[i] + off, this.coordH(v) - g.ml, bw, 4), color: this.colorOf(k), si: k, i });
          else out.push({ path: rtop(g.cx[i] + off, this.coordV(v), bw, g.mt + g.ph - this.coordV(v), 4), color: this.colorOf(k), si: k, i });
        });
      }
    }
    return out;
  });

  readonly paths = computed(() => {
    if (this.type() !== 'line') return [];
    const g = this.geo();
    return this.series().map((s, si) => {
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${g.cx[i].toFixed(1)},${this.coordV(v).toFixed(1)}`;
        pen = true;
      });
      return { d, si };
    });
  });

  readonly dots = computed(() => {
    if (this.type() !== 'line') return [];
    const g = this.geo();
    const out: { x: number; y: number; si: number; big: boolean }[] = [];
    this.series().forEach((s, si) => s.values.forEach((v, i) => { if (v !== null && v !== undefined) out.push({ x: g.cx[i], y: this.coordV(v), si, big: this.hover() === i }); }));
    return out;
  });

  readonly valueTexts = computed(() => {
    const g = this.geo(), n = this.labels().length, ns = this.series().length;
    const want = this.showValues() ?? (this.hor() ? !this.stacked() && ns === 1 : this.type() === 'bar' && !this.stacked() && ns === 1 && n <= 12);
    if (!want) return [];
    const out: { x: number; y: number; text: string; anchor: string }[] = [];
    const s = this.series()[0];
    if (!s) return out;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return;
      if (this.hor()) out.push({ x: this.coordH(v) + 5, y: g.cy[i] + 4, text: this.fmt()(v), anchor: 'start' });
      else out.push({ x: g.cx[i], y: this.coordV(v) - 6, text: this.fmt()(v), anchor: 'middle' });
    });
    return out;
  });

  readonly xLabels = computed(() => {
    const g = this.geo(), ls = this.labels();
    const maxLen = this.hor() ? 15 : 16;
    const stride = this.hor() ? 1 : Math.max(1, Math.ceil((ls.length * (Math.min(maxLen, Math.max(...ls.map((l) => l.length), 1)) * 6.4 + 10)) / g.pw));
    return ls.map((full, i) => ({ full, text: full.length > maxLen ? full.slice(0, maxLen - 1) + '…' : full, p: this.hor() ? g.cy[i] : g.cx[i] })).filter((_, i) => i % stride === 0);
  });

  tipX = computed(() => {
    const i = this.hover(); if (i === null) return 0;
    const g = this.geo();
    return ((this.hor() ? g.ml + g.pw * 0.5 : g.cx[i]) / W) * 100;
  });
  tipY = computed(() => {
    const i = this.hover(); if (i === null) return 0;
    const g = this.geo();
    return ((this.hor() ? g.cy[i] - 8 : g.mt + 18) / g.H) * 100;
  });
  tipSide = computed(() => {
    if (this.hor()) return 'c';
    const i = this.hover(); if (i === null) return 'c';
    const f = this.geo().cx[i] / W;
    return f > 0.72 ? 'r' : f < 0.28 ? 'l' : 'c';
  });
}


@Component({
  selector: 'app-spark',
  template: `
  @if (pts().length > 1) {
    <svg [attr.viewBox]="'0 0 120 ' + h()" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      <path [attr.d]="area()" [attr.fill]="color()" opacity=".14" />
      <path [attr.d]="line()" fill="none" [attr.stroke]="color()" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
  }`,
  host: { class: 'spark' },
  styles: `:host { display: block; margin-top: 6px; } svg { width: 100%; height: 34px; display: block; overflow: visible; }`,
})
export class Spark {
  readonly values = input<(number | null)[]>([]);
  readonly color = input('var(--brand)');
  readonly label = input('Tendance');
  readonly h = input(34);
  readonly pts = computed(() => {
    const v = this.values().filter((x): x is number => x !== null && x !== undefined);
    if (v.length < 2) return [];
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1, h = this.h();
    return v.map((x, i) => ({ x: (i / (v.length - 1)) * 120, y: 4 + (1 - (x - min) / span) * (h - 8) }));
  });
  readonly line = computed(() => this.pts().map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''));
  readonly area = computed(() => { const p = this.pts(); return p.length ? `${this.line()}L120,${this.h()}L0,${this.h()}Z` : ''; });
}
