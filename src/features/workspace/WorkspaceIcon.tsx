const ICONS = {
  rewrite: <><path d="m4 16-1 5 5-1L20 8l-4-4Z" /><path d="m13 7 4 4M3 21l5-1" /></>,
  transform: <><path d="m4 20 12-12 3 3L7 23ZM6 3v6M3 6h6M18 2v4M16 4h4" /></>,
  expand: <><path d="M9 12H3l4-4M3 12l4 4M15 12h6l-4-4M21 12l-4 4M12 4v16" /></>,
  condense: <><path d="M2 12h7l-4-4M9 12l-4 4M22 12h-7l4-4M15 12l4 4M12 4v16" /></>,
  custom: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="19" r="2" /></>,
  dictionary: <><path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1Zm0 0v15M5 8h4M15 8h4" /></>,
  infill: <><path d="M4 4h16M4 20h16M7 12h10M12 7v10" /></>,
  continue: <><path d="M4 4h16M4 9h16M4 14h8M4 19h8M15 18h6l-3-3M21 18l-3 3" /></>,
  "context-insert": <><path d="M4 5h7M4 19h7M7 5v14M12 12h10M17 7v10" /></>,
  describe: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  "guided-write": <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M5 7v8a4 4 0 0 0 4 4h8M12 5h9l-4-4M21 5l-4 4" /></>,
  feedback: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10l2 2 4-4" /></>,
  memory: <><rect x="5" y="3" width="15" height="16" rx="2" /><path d="M4 7H2v15h15v-2M9 8h7M9 12h5" /></>,
  chapters: <><path d="M8 5h13M8 12h13M8 19h13M3 4v2M3 11v2M3 18v2" /></>,
  history: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2" /></>,
  typography: <><path d="M3 5h10M8 5v14M5 19h6M17 5h4M17 10h4M17 15h4M17 20h4" /></>,
  backup: <path d="M3 7V4h7l2 3h9v13H3Zm0 3h18" />,
  connections: <><circle cx="5" cy="12" r="3" /><circle cx="19" cy="5" r="3" /><circle cx="19" cy="19" r="3" /><path d="m8 11 8-5M8 13l8 5" /></>,
  settings: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
};

// Decorative, code-native icons; the adjacent Japanese text names each control.
export function WorkspaceIcon({ name }: Readonly<{ name: keyof typeof ICONS }>) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {ICONS[name]}
  </svg>;
}
