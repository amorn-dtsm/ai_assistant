import React, { useEffect, useState } from "react";
import { FullScreenLoader } from "@/components/Preloader";
import { completeOidcLogin } from "@/utils/keycloakAuth";

export default function OidcCallback() {
  const [error, setError] = useState(null);

  useEffect(() => {
    completeOidcLogin()
      .then(() => {
        window.location.replace("/");
      })
      .catch((e) => {
        setError(e.message || "OIDC login failed.");
      });
  }, []);

  if (error)
    return (
      <div className="w-screen h-screen overflow-hidden bg-theme-bg-primary flex items-center justify-center flex-col gap-4">
        <p className="text-theme-text-primary font-mono text-lg">{error}</p>
        <a
          href="/login"
          className="text-theme-text-secondary font-mono text-sm hover:underline"
        >
          Back to login
        </a>
      </div>
    );

  return <FullScreenLoader />;
}
