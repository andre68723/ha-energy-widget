import { css } from "lit";

export const cardStyles = css`
  :host {
    display: block;
  }
  ha-card {
    height: 100%;
    box-sizing: border-box;
    padding: 12px;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: default;
  }
  ha-card.actionable {
    cursor: pointer;
  }
  ha-card:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -2px;
  }
  .title {
    font-size: var(--ha-card-header-font-size, 1.25rem);
    padding: 4px 4px 0;
  }
  .rings {
    display: grid;
    grid-template-columns: repeat(var(--ring-count, 4), minmax(0, 1fr));
    gap: 8px;
    justify-items: center;
  }
  @container (max-width: 260px) {
    .rings {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .ring,
  .nested {
    width: 100%;
    max-width: 170px;
    aspect-ratio: 1;
  }
  .nested {
    max-width: 220px;
    align-self: center;
  }
  .rings.single {
    grid-template-columns: minmax(0, 1fr);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .track {
    fill: none;
    stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
    opacity: 0.6;
  }
  .arc {
    fill: none;
    stroke-linecap: round;
    transition:
      stroke-dasharray 0.6s ease,
      stroke-dashoffset 0.6s ease;
  }
  .value {
    font-size: 21px;
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
    font-variant-numeric: tabular-nums;
  }
  /* The timeline takes whatever height the card is given; the rings keep their square size. */
  .timeline {
    flex: 1 1 0;
    min-height: 56px;
  }
  .rings {
    flex: 0 0 auto;
  }
  /* Rings only: center them in a tall card instead of leaving the space below. */
  .rings:last-child {
    margin-block: auto;
  }
  .forecast {
    fill: none;
    stroke: var(--secondary-text-color, gray);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    opacity: 0.85;
  }
  .now {
    stroke: var(--secondary-text-color, gray);
    stroke-width: 1;
    stroke-dasharray: 2 3;
    vector-effect: non-scaling-stroke;
    opacity: 0.5;
  }
  .message {
    color: var(--secondary-text-color);
    text-align: center;
    padding: 16px 8px;
  }
  .message.error {
    color: var(--error-color, #db4437);
  }
  @media (prefers-reduced-motion: reduce) {
    .arc {
      transition: none;
    }
  }
`;
