// Inline SVG glyphs for the workspace explorer (file, trash, new-folder, pencil).

export function FileIcon() {
  return (
    <svg className="files-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5L13 5.5v8.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5a.5.5 0 00.5.5H13" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5a1 1 0 001 .9h2.8a1 1 0 001-.9l.6-8.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NewFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 4.5l1-1.5h3l1 1.5h6a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1v-6z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M11 7v3M9.5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
