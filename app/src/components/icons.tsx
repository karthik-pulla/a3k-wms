import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
};

/** Arrow entering a door: goods coming in */
export const InboundIcon = () => (
  <svg {...base}><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M4 12h11" /><path d="m11 8 4 4-4 4" /></svg>
);
/** Two turning arrows: stock in rotation */
export const InventoryIcon = () => (
  <svg {...base}><path d="M20 11a8 8 0 0 0-14.6-4.4L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.6 4.4L20 16" /><path d="M20 21v-5h-5" /></svg>
);
/** Arrow leaving a door: goods going out */
export const OutboundIcon = () => (
  <svg {...base}><path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M9 12h11" /><path d="m16 8 4 4-4 4" /></svg>
);
export const HomeIcon = () => (
  <svg {...base}><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10" /></svg>
);
export const SettingsIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const CloseIcon = () => (<svg {...base}><path d="M18 6 6 18M6 6l12 12" /></svg>);
export const UpIcon = () => (<svg {...base}><path d="m18 15-6-6-6 6" /></svg>);
export const DownIcon = () => (<svg {...base}><path d="m6 9 6 6 6-6" /></svg>);
/** Speech bubble: Messages */
export const ChatIcon = () => (
  <svg {...base}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14.5h4" /></svg>
);
export const SendIcon = () => (<svg {...base}><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></svg>);
export const BackIcon = () => (<svg {...base}><path d="m15 18-6-6 6-6" /></svg>);
export const SearchIcon = () => (<svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>);
export const CameraIcon = () => (<svg {...base}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>);
export const InfoIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>);
export const ExpandIcon = () => (<svg {...base}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>);
export const FilterIcon = () => (<svg {...base}><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>);
export const SortIcon = () => (<svg {...base}><path d="M4 6h16M7 12h10M10 18h4" /></svg>);
export const KeyboardIcon = () => (<svg {...base}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>);
/** Clipboard with a tick: tasks */
export const TasksIcon = () => (<svg {...base}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="m9 13 2 2 4-4" /></svg>);
/** Lines of a record: logs */
export const TeamIcon = () => (<svg {...base}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.2c2.4.1 4.3 1.7 4.9 4.8" /></svg>);
export const LogsIcon = () => (<svg {...base}><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>);
/** Pallet with a clock: the worker's screen */
export const WorkIcon = () => (<svg {...base}><path d="M3 18h18M5 18v-3h14v3" /><rect x="7" y="7" width="10" height="8" rx="1" /><path d="M12 9v3l2 1" /></svg>);
/** Question mark in a circle: Help */
export const HelpIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" /></svg>);
/** Sliders: Manage warehouse */
export const ManageIcon = () => (<svg {...base}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>);
