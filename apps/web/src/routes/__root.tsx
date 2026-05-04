import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const THEME_INIT_SCRIPT = `document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "OpenWish",
      },
      {
        name: "theme-color",
        content: "#0a0f14",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased text-slate-50">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
