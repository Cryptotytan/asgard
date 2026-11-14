import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Asgard";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: "Asgard markets for the NEAR ecosystem. Open any token, scan it, and trade the cheapest lowest-impact route." },
      { name: "theme-color", content: "#000000" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var key="asgard-chunk-tries";try{sessionStorage.removeItem(key+"-go");}catch(e){}function stale(reason){var text=String(reason&&reason.message||reason||"");return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(text);}function recover(reason){if(!stale(reason))return false;try{if(sessionStorage.getItem(key+"-go")==="1")return true;var n=Number(sessionStorage.getItem(key)||0);if(n>=2)return false;sessionStorage.setItem(key+"-go","1");sessionStorage.setItem(key,String(n+1));}catch(e){return false;}var url=new URL(location.href);url.searchParams.set("asgard",String(Date.now()));location.replace(url.toString());return true;}window.addEventListener("vite:preloadError",function(event){if(recover(event&&event.payload))event.preventDefault();});window.addEventListener("unhandledrejection",function(event){if(recover(event&&event.reason))event.preventDefault();});setTimeout(function(){try{sessionStorage.removeItem(key);}catch(e){}},8000);})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
