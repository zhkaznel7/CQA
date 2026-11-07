<script setup>
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 19 } })
const paths = {
  "grid": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  "chat": "M21 11a8 8 0 0 1-8 8H8l-5 3 1.4-5A8 8 0 1 1 21 11Z M8 10h8 M8 13h5",
  "messages": "M4 3h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H3V5a2 2 0 0 1 1-2z M10 19h7l4 3v-4a2 2 0 0 0 1-2V9",
  "phone": "M5 3l3-1 3 6-3 2c1.5 3.2 3.3 5 6.3 6.4l2.2-3.1 5.2 3-1 3.5c-.5 1.5-2 2.3-4.1 1.7C10 19.8 4.3 14.2 2.8 7.7 2.4 6 3 4 5 3z",
  "clipboard": "M8 5H5v16h14V5h-3 M9 3h6v4H9z M8 12l1.5 1.5L12 11 M14 12h2 M8 17h8",
  "scale": "M12 3v17 M7 21h10 M3 7l18-2 M5 7l-3 7h6L5 7z M18 6l-3 7h6z",
  "refresh": "M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5 M4 16a8 8 0 0 0 14 2l3-3m0 5v-5h-5",
  "arrow-right": "M4 12h15m-6-6 6 6-6 6",
  "chevron-right": "m9 5 7 7-7 7",
  "clock": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 6v6l4 2",
  "chart": "M3 4v16h18 M7 16v-4 M12 16V7 M17 16v-6",
  "languages": "M2 5h12 M8 2v3 M5 6c1 5 3 7 8 10 M12 5c-1 6-5 10-10 13 M14 21l4-11 4 11 M15.5 17h5",
  "layers": "m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  "list": "M8 6h13 M8 12h13 M8 18h13 M3 6h.1 M3 12h.1 M3 18h.1",
  "search": "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z M15.5 15.5 21 21",
  "filter": "M3 5h18l-7 8v6l-4 2v-8z",
  "globe": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M3 12h18 M12 3c-6 5-6 13 0 18 6-5 6-13 0-18z",
  "menu": "M3 6h18 M3 12h18 M3 18h18",
  "panel": "M3 4h18v16H3z M9 4v16",
  "help": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1.1-1.5 3 M12 17h.01",
  "close": "m6 6 12 12 M18 6 6 18",
  "calendar": "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
  "server": "M3 4h18v6H3z M3 14h18v6H3z M6 7h.2 M6 17h.2",
  "external": "M13 3h8v8 M21 3 10 14 M10 4H4v16h16v-6",
  "message": "M21 11a8 8 0 0 1-8 8H8l-5 3 1.4-5A8 8 0 1 1 21 11Z M8 10h8 M8 13h5"
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name]" />
  </svg>
</template>
