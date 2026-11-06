<script lang="ts">
  import { untrack } from 'svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { cn } from '$lib/utils';
  import { domainTicks, spillSide, type Swimlane, type TimeDomain } from './swimlane';

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
    /** The inline sizing of the strip inside it: the peek draws the same lanes at 10 px of padding. */
    innerStyle?: string;
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
    innerStyle,
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

  /**
   * The bars whose text is drawn beside them, and on which side (`spillSide`). Whether words fit is a
   * question about pixels - the font, the width the strip got - so it is answered by measuring the
   * drawn lanes, again whenever they change or the strip is resized. A spilt bar keeps its copy of the
   * text, hidden (dfm-ext.css `.bar.spilt`): it is what the next measurement measures.
   */
  let spill = $state<Readonly<Record<string, 'right' | 'left'>>>({});

  /** A computed length in pixels; nothing where there is no stylesheet to compute it from. */
  function pixels(value: string): number {
    return Number.parseFloat(value) || 0;
  }

  function measure(): void {
    if (!root) {
      return;
    }

    const next: Record<string, 'right' | 'left'> = {};

    for (const track of root.querySelectorAll<HTMLElement>('.track')) {
      const bars = Array.from(track.querySelectorAll<HTMLElement>(':scope > .bar'))
        .map((element) => ({ element, left: element.offsetLeft, right: element.offsetLeft + element.offsetWidth }))
        .sort((a, b) => a.left - b.left);

      bars.forEach((bar, index) => {
        const text = bar.element.querySelector<HTMLElement>(':scope > .bar-text');

        if (!text) {
          return;
        }

        const style = getComputedStyle(bar.element);
        const inner = bar.element.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight);
        const before = bar.left - (index > 0 ? bars[index - 1].right : 0);
        const after = (index < bars.length - 1 ? bars[index + 1].left : track.clientWidth) - bar.right;
        const side = spillSide(text.offsetWidth, inner, before, after);

        if (side !== 'inside' && bar.element.dataset.bar) {
          next[bar.element.dataset.bar] = side;
        }
      });
    }

    const current = untrack(() => spill);
    const keys = Object.keys(next);
    const same = keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key]);

    if (!same) {
      spill = next;
    }
  }

  $effect(() => {
    // Measured again whenever the lanes are redrawn...
    void lanes;

    const frame = root;

    if (!frame) {
      return;
    }

    measure();

    // ...when the web font arrives and changes how wide the words are...
    void document.fonts?.ready.then(() => measure());

    // ...and when the strip is given another width
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => measure());

    observer.observe(frame);

    return () => observer.disconnect();
  });

  /** Where a spilt bar's text sits: just past its right end, or just before its left one. */
  function spillStyle(bar: { left: number; width: number }, side: 'right' | 'left'): string {
    return side === 'right' ? `left:calc(${bar.left + bar.width}% + 6px)` : `right:calc(${100 - bar.left}% + 6px)`;
  }
</script>

<!--
  HTML lanes rather than SVG, exactly as ScreenInstance.dc.html L89-L98 draws them: `.swim > .swim-in
  > .axis + .lane*`, each lane a label and a `.track` of absolutely positioned `.bar`s.
-->
<!-- `tabindex="0"` on the frame: it scrolls sideways, and a keyboard has to be able to scroll it
     even when the lane it wants is off the right edge (axe `scrollable-region-focusable`). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div bind:this={root} class={cn('swim', className)} {style} role="group" aria-label={ariaLabel} tabindex="0">
  <div class="swim-in" style={`min-width:${minWidth}px;${innerStyle ?? ''}`}>
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
            <!-- A bar that does something is a button: focusable, named by what its tooltip says, and
                 pressed with Enter or Space. A bar that does nothing stays a shape. -->
            <!-- `bare`: a bar with no text of its own is drawn without the padding that would make it
                 wider than its time, so the label beside it (`.blbl`) does not land on top of it.
                 `spilt`: a bar narrower than its own text, which is drawn beside it instead -->
            <div
              class={cn(
                'bar',
                bar.cls ?? '',
                bar.text ? '' : 'bare',
                spill[bar.key] ? 'spilt' : '',
                highlightKey === bar.key ? 'hl' : '',
              )}
              data-bar={bar.key}
              style={`left:${bar.left}%;width:${bar.width}%`}
              title={bar.title}
              role={onBarClick ? 'button' : undefined}
              tabindex={onBarClick ? 0 : undefined}
              aria-label={onBarClick ? (bar.title ?? bar.text ?? bar.key) : undefined}
              onclick={() => onBarClick?.(lane.key, bar)}
              onkeydown={(event) => {
                if (onBarClick && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onBarClick(lane.key, bar);
                }
              }}
            >
              {#if bar.text}<span class="bar-text">{bar.text}</span>{/if}
            </div>

            {#if bar.text && spill[bar.key]}
              <span class="blbl" style={spillStyle(bar, spill[bar.key])}>{bar.text}</span>
            {/if}
          {/each}

          {#if lane.lbl}
            <!-- Past the bar's own edge: a bar is never drawn narrower than its 4 px frame -->
            <span class="blbl" style={`left:calc(${lane.lblLeft ?? 0}% + 6px)`}>{lane.lbl}</span>
          {/if}

          {#if lane.now !== undefined}
            <div class="now" style={`left:${lane.now}%`}></div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
