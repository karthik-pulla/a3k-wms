// The public demo site (VITE_WMS_DEMO=1 with the preview): its ready-made logins, made in each visitor's own browser
// by preview.ts and shown on the sign-in screens. Made-up accounts holding made-up data; nothing real uses them.
export const isPublicDemo = import.meta.env.VITE_WMS_DEMO === "1";
export const DEMO_LOGINS = { warehouse: ["owner", "coordinator", "worker"], console: "owner", password: "rack-and-pallet-26" } as const;
/** Where "Book a visit" points on the demo site (GitHub can't receive the form; the real site keeps the requests) */
export const DEMO_CONTACT = "join.propel@gmail.com";
