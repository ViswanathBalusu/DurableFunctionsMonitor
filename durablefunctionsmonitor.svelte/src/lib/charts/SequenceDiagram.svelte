<script lang="ts" module>
  import type { SequenceMessage, SequenceModel } from '$lib/instance/sequence-model';

  /** The gutter the timestamp column takes, and the width of one lane (dfm-ui.css L322-L323). */
  export const GUTTER = 90;
  export const LANE_WIDTH = 160;

  /** How far a self-message loops to the left of its own lane. */
  export const SELF_LOOP = 60;

  /** The centre of one lane, in pixels from the left of `.seq-in` (mockup L194: 170, 330, 490…). */
  export function laneX(index: number): number {
    return GUTTER + LANE_WIDTH / 2 + index * LANE_WIDTH;
  }

  export interface ArrowGeometry {
    /** Pixels from the left of the row, which starts at the gutter. */
    left: number;
    width: number;
    /** Right to left: the head is drawn on the other end. */
    back: boolean;
    failed: boolean;
    self: boolean;
  }

  /** Where one message's arrow sits, given the lanes it goes between. */
  export function arrowOf(message: SequenceMessage, participants: string[]): ArrowGeometry {
    const from = Math.max(0, participants.indexOf(message.from));
    const to = Math.max(0, participants.indexOf(message.to));

    const self = from === to;
    const failed = message.kind === 'failed';

    if (self) {
      // A loop to the left of the lane: there is no second lane to reach for
      return { left: laneX(from) - SELF_LOOP, width: SELF_LOOP, back: false, failed, self: true };
    }

    const back = to < from;

    return {
      left: Math.min(laneX(from), laneX(to)),
      width: Math.abs(laneX(to) - laneX(from)),
      back,
      failed,
      self: false,
    };
  }
</script>

<script lang="ts">
  import { inkColor, tokenColor } from './chart-tokens';

  interface Props {
    model: SequenceModel;
    /** The lane drawn as the orchestrator's (`n-orchestrator`); the first one by default. */
    orchestrator?: string;
    /** How each row's clock column reads. */
    formatTime?: (iso: string) => string;
    ariaLabel?: string;
  }

  let { model, orchestrator, formatTime = (iso) => iso, ariaLabel = 'Sequence diagram' }: Props = $props();

  const participants = $derived(model.participants);

  const main = $derived(orchestrator ?? participants[0] ?? '');

  const width = $derived(GUTTER + participants.length * LANE_WIDTH);

  let root = $state<HTMLDivElement | null>(null);

  /**
   * The same diagram as a standalone SVG: boxes, dashed lifelines, square arrowheads and mono
   * labels. Built rather than serialized from the DOM, because the page's diagram is HTML.
   */
  export function toSvg(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const rowHeight = 40;
    const top = 64;
    const height = top + model.messages.length * rowHeight + 16;
    const ink = inkColor();
    const failedColor = tokenColor('status-failed');

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const el = (name: string, attributes: Record<string, string>, text?: string): SVGElement => {
      const node = document.createElementNS(ns, name);

      for (const [key, value] of Object.entries(attributes)) {
        node.setAttribute(key, value);
      }

      if (text !== undefined) {
        node.textContent = text;
      }

      svg.appendChild(node);

      return node;
    };

    participants.forEach((participant, index) => {
      const x = laneX(index);

      el('rect', {
        x: String(x - LANE_WIDTH / 2 + 10),
        y: '10',
        width: String(LANE_WIDTH - 20),
        height: '40',
        fill: 'none',
        stroke: ink,
        'stroke-width': '2',
      });

      el(
        'text',
        {
          x: String(x),
          y: '35',
          'text-anchor': 'middle',
          'font-family': 'monospace',
          'font-size': '12',
          'font-weight': '600',
          fill: ink,
        },
        participant,
      );

      el('line', {
        x1: String(x),
        y1: '54',
        x2: String(x),
        y2: String(height - 8),
        stroke: ink,
        'stroke-width': '2',
        'stroke-dasharray': '6 4',
      });
    });

    model.messages.forEach((message, index) => {
      const geometry = arrowOf(message, participants);
      const y = top + index * rowHeight + rowHeight / 2;
      const color = geometry.failed ? failedColor : ink;

      el(
        'text',
        { x: '0', y: String(y + 4), 'font-family': 'monospace', 'font-size': '11', fill: ink },
        formatTime(message.t),
      );

      el('line', {
        x1: String(geometry.left),
        y1: String(y),
        x2: String(geometry.left + geometry.width),
        y2: String(y),
        stroke: color,
        'stroke-width': '2',
      });

      // A square head, on whichever end the arrow points at
      const headX = geometry.back ? geometry.left : geometry.left + geometry.width - 8;

      el('rect', { x: String(headX), y: String(y - 4), width: '8', height: '8', fill: color });

      el(
        'text',
        {
          x: String(geometry.left + geometry.width / 2),
          y: String(y - 6),
          'text-anchor': 'middle',
          'font-family': 'monospace',
          'font-size': '11',
          fill: ink,
        },
        message.label,
      );
    });

    return svg;
  }

  export function element(): HTMLDivElement | null {
    return root;
  }
</script>

<!--
  ScreenInstance.dc.html L192-L198 and dfm-ui.css L320-L334: the participants across the top, a
  dashed lifeline under each, and one row per message with its clock in the gutter. The arrow is
  positioned in pixels because the lanes are: 90px of gutter and 160px per lane.
-->
<div class="seq" role="group" aria-label={ariaLabel}>
  <div class="seq-in" bind:this={root} style={`min-width:${width}px`}>
    <div class="parts" style={`grid-template-columns:${GUTTER}px repeat(${participants.length}, ${LANE_WIDTH}px)`}>
      <span></span>
      {#each participants as participant (participant)}
        <div class={participant === main ? 'part n-orchestrator' : 'part'}>{participant}</div>
      {/each}
    </div>

    {#each participants as participant, index (participant)}
      <div class="life" style={`left:${laneX(index)}px`}></div>
    {/each}

    {#each model.messages as message, index (index)}
      {@const arrow = arrowOf(message, participants)}
      <div class="smsg">
        <span class="t">{formatTime(message.t)}</span>
        <div
          class={['arrow', arrow.back ? 'back' : '', arrow.failed ? 'failed' : ''].filter(Boolean).join(' ')}
          style={`left:${arrow.left}px;width:${arrow.width}px`}
          title={message.note}
        >
          <span>{message.label}</span>
        </div>
      </div>
    {/each}
  </div>
</div>
