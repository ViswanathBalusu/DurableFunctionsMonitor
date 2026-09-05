<script lang="ts" module>
  export type NavIconName =
    | 'overview'
    | 'instances'
    | 'failures'
    | 'entities'
    | 'functions'
    | 'storage'
    | 'activity'
    | 'settings'
    | 'collapse'
    | 'expand';
</script>

<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';

  interface Props extends SVGAttributes<SVGSVGElement> {
    name: NavIconName;
    class?: string;
  }

  let { name, class: cls = '', ...rest }: Props = $props();
</script>

<!--
  Exact inline SVG paths from `DFM App.dc.html` L28-L37 (nav items) and L373 (expand glyph).
  viewBox is always 24x24; sizing and stroke come from the `.ico` rule in dfm-ui.css.
-->
<svg {...rest} class="ico {cls}" viewBox="0 0 24 24" aria-hidden="true">
  {#if name === 'overview'}
    <rect x="3" y="3" width="8" height="8"></rect>
    <rect x="13" y="3" width="8" height="8"></rect>
    <rect x="3" y="13" width="8" height="8"></rect>
    <rect x="13" y="13" width="8" height="8"></rect>
  {:else if name === 'instances'}
    <line x1="4" y1="6" x2="20" y2="6"></line>
    <line x1="4" y1="12" x2="20" y2="12"></line>
    <line x1="4" y1="18" x2="20" y2="18"></line>
  {:else if name === 'failures'}
    <path d="M12 3l9 17H3z"></path>
    <line x1="12" y1="10" x2="12" y2="14"></line>
    <line x1="12" y1="17" x2="12" y2="17.5"></line>
  {:else if name === 'entities'}
    <rect x="4" y="4" width="16" height="16"></rect>
    <rect x="9" y="9" width="6" height="6"></rect>
  {:else if name === 'functions'}
    <circle cx="6" cy="12" r="3"></circle>
    <circle cx="18" cy="6" r="3"></circle>
    <circle cx="18" cy="18" r="3"></circle>
    <line x1="9" y1="11" x2="15" y2="7"></line>
    <line x1="9" y1="13" x2="15" y2="17"></line>
  {:else if name === 'storage'}
    <ellipse cx="12" cy="6" rx="8" ry="3"></ellipse>
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path>
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>
  {:else if name === 'activity'}
    <polyline points="3 12 7 12 10 5 14 19 17 12 21 12"></polyline>
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3"></circle>
    <path
      d="M19 12a7 7 0 0 0-.1-1.2l2.1-1.6-2-3.4-2.5 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.5-1-2 3.4 2.1 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2L3 14.8l2 3.4 2.5-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.5 1 2-3.4-2.1-1.6c.1-.4.1-.8.1-1.2z"
    ></path>
  {:else if name === 'collapse'}
    <polyline points="15 6 9 12 15 18"></polyline>
  {:else if name === 'expand'}
    <polyline points="9 6 15 12 9 18"></polyline>
  {/if}
</svg>
