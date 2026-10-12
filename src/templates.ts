import { html, nothing, svg } from "lit";
import type { RingSpec, TimelineView } from "./view";
import { COLUMN, HEIGHT } from "./view";

const CENTER = 50;

function arcs(spec: RingSpec, radius: number, stroke: number) {
  let start = 0;
  const circumference = 100; // pathLength
  return spec.segments.map((segment) => {
    const length = (segment.value / spec.max) * circumference;
    const offset = start;
    start += length;
    if (!(length > 0.05)) return nothing;
    return svg`<circle class="arc" cx=${CENTER} cy=${CENTER} r=${radius} pathLength="100"
      transform="rotate(-90 ${CENTER} ${CENTER})" stroke=${segment.color} stroke-width=${stroke}
      stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset=${-offset}></circle>`;
  });
}

/** One ring with its value in the middle, as in the iOS widget. */
export function ringTemplate(spec: RingSpec, label: string) {
  return html`<div class="ring" role="img" aria-label="${label}: ${spec.text}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx=${CENTER} cy=${CENTER} r="45.5" stroke-width="9" pathLength="100"></circle>
      ${arcs(spec, 45.5, 9)}
      <text x=${CENTER} y=${CENTER} class="value" fill=${spec.textColor}>${spec.text}</text>
    </svg>
  </div>`;
}

/** Concentric rings (style 4 of the iOS widget); the first spec is the outermost. */
export function nestedRingsTemplate(specs: RingSpec[], labels: string[]) {
  const label = specs.map((s, i) => `${labels[i]} ${s.text}`).join(", ");
  return html`<div class="nested" role="img" aria-label=${label}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      ${specs.map((spec, i) => {
        const radius = 46.5 - i * 8.5;
        return svg`<circle class="track" cx=${CENTER} cy=${CENTER} r=${radius} stroke-width="7" pathLength="100"></circle>
          ${arcs(spec, radius, 7)}`;
      })}
    </svg>
  </div>`;
}

export function timelineTemplate(view: TimelineView, label: string) {
  return html`<div class="timeline" role="img" aria-label=${label}>
    <svg viewBox="0 0 ${COLUMN * 96} ${HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
      ${view.bars.map(
        (b) =>
          svg`<rect x=${b.x} y=${b.y.toFixed(2)} width=${(COLUMN * 0.75).toFixed(2)} height=${b.height.toFixed(2)}
            fill=${b.color} opacity=${b.faded ? 0.45 : 1}></rect>`,
      )}
      ${view.forecast ? svg`<path class="forecast" d=${view.forecast}></path>` : nothing}
      ${view.nowX > 0 && view.nowX < COLUMN * 96 ? svg`<line class="now" x1=${view.nowX} x2=${view.nowX} y1="0" y2=${HEIGHT}></line>` : nothing}
    </svg>
  </div>`;
}
