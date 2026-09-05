<script lang="ts">
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { cn } from '$lib/utils';
  import { domainTicks, type Swimlane, type TimeDomain } from './swimlane';

  interface Props {
    lanes: Swimlane[];
    domain: TimeDomain;
    /** How many tick labels the axis shows. */
    ticks?: number;
    formatTick?: (date: Date, index: number) => string;
    /** The axis label above the lane labels ("span"). */
    axisLabel?: string;
    /**
     * The lane (or bar) to outline, for the hover linkage with the History table. A lane is
     * outlined when it is the one named or when it holds the bar that is: hovering the row of a
     * second attempt has to light up the lane that attempt is drawn on.
     */
    highlightKey?: string | null;
    /** The narrowest the lane strip may get before it scrolls horizontally. */
    minWidth?: number;
    ariaLabel: string;
    class?: string;
    /** The inline sizing a screen sets on the frame (the view strip leaves no top border). */
    style?: string;
    onLaneEnter?: (key: string) => void;
    onLaneLeave?: () => void;
    /** A click anywhere on the lane that is not its label (which follows its own href). */
    onLaneClick?: (key: string) => void;
    /** A click on a lane's label, for a caller that navigates itself rather than through the href. */
    onLaneLabelClick?: (key: string, event: MouseEvent) => void;
    onBarClick?: (laneKey: string, bar: { key: string; sequenceNumbers?: number[] }) => void;
  }

  let {
    lanes,
    domain,
    ticks = 6,
    formatTick = (date: Date) => date.toISOString().slice(11, 19),
    axisLabel = 'span',
    highlightKey = null,
    minWidth = 720,
    ariaLabel,
    class: className,
    style,
    onLaneEnter,
    onLaneLeave,
    onLaneClick,
    onLaneLabelClick,
    onBarClick,
  }: Props = $props();

  const tickTimes = $derived(domainTicks(domain, ticks));

  let root = $state<HTMLDivElement | null>(null);

  /**
   * The same picture as an SVG, for "Save as SVG". Rebuilt from the model rather than scraped from
   * the DOM: the lanes are HTML - which is what lets dfm-ui.css draw the dotted waiting bars, the
   * thin orchestrator bars and the dashed now line - and HTML does not serialise into an image.
   */
  export function toSvg(): SVGSVGElement {
    const laneHeight = 32;
    const labelWidth = 180;
    const width = minWidth;
    const height = lanes.length * laneHeight + 24;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    lanes.forEach((lane, index) => {
      const y = 24 + index * laneHeight;

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', String(y + 16));
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('font-size', '12');
      label.textContent = lane.label;
      svg.appendChild(label);

      const trackWidth = width - labelWidth;

      for (const bar of lane.bars) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(labelWidth + (bar.left / 100) * trackWidth));
        rect.setAttribute('y', String(y + 4));
        rect.setAttribute('width', String(Math.max(1, (bar.width / 100) * trackWidth)));
        rect.setAttribute('height', '24');
        rect.setAttribute('fill', 'var(--card)');
        rect.setAttribute('stroke', 'var(--ink)');
        rect.setAttribute('stroke-width', '2');
        svg.appendChild(rect);

        if (bar.text) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(labelWidth + (bar.left / 100) * trackWidth + 6));
          text.setAttribute('y', String(y + 20));
          text.setAttribute('font-family', 'monospace');
          text.setAttribute('font-size', '11');
          text.textContent = bar.text;
          svg.appendChild(text);
        }
      }
    });

    return svg;
  }

  /** The rendered element, so a caller can measure it - or scroll a lane of it into view. */
  export function element(): HTMLDivElement | null {
    return root;
  }

  function isLaneHighlighted(lane: Swimlane): boolean {
    return highlightKey !== null && (lane.key === highlightKey || lane.bars.some((bar) => bar.key === highlightKey));
  }
</script>

<!--
  HTML lanes rather than SVG, exactly as ScreenInstance.dc.html L89-L98 draws them: `.swim > .swim-in
  > .axis + .lane*`, each lane a label and a `.track` of absolutely positioned `.bar`s.
-->
<div bind:this={root} class={cn('swim', className)} {style} role="group" aria-label={ariaLabel}>
  <div class="swim-in" style={`min-width:${minWidth}px`}>
    <div class="axis">
      <span class="meta">{axisLabel}</span>
      <span class="ticks">
        {#each tickTimes as tick, index (index)}
          <span>{formatTick(tick, index)}</span>
        {/each}
      </span>
    </div>

    {#each lanes as lane (lane.key)}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
      <div
        class={cn('lane', isLaneHighlighted(lane) ? 'hl' : '')}
        data-lane={lane.key}
        onmouseenter={() => onLaneEnter?.(lane.key)}
        onmouseleave={() => onLaneLeave?.()}
        onclick={() => onLaneClick?.(lane.key)}
      >
        <span class="lbl" title={lane.label}>
          {#if lane.href}
            <!-- A real link, so the lane can be copied and opened in a new tab (the peek is the click) -->
            <LinkButton mono stopPropagation href={lane.href} onclick={(event) => onLaneLabelClick?.(lane.key, event)}>
              {lane.label}
            </LinkButton>
          {:else}
            {lane.label}
          {/if}
        </span>
        <div class="track">
          {#each lane.bars as bar (bar.key)}
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
            <div
              class={cn('bar', bar.cls ?? '', highlightKey === bar.key ? 'hl' : '')}
              data-bar={bar.key}
              style={`left:${bar.left}%;width:${bar.width}%`}
              title={bar.title}
              onclick={() => onBarClick?.(lane.key, bar)}
            >
              {bar.text ?? ''}
            </div>
          {/each}

          {#if lane.lbl}
            <span class="blbl" style={`left:${lane.lblLeft ?? 0}%`}>{lane.lbl}</span>
          {/if}

          {#if lane.now !== undefined}
            <div class="now" style={`left:${lane.now}%`}></div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
