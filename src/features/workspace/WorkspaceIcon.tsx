const ICONS = {
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
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
