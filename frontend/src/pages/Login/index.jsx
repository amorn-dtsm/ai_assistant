import React, { useState, useEffect } from "react";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { FullScreenLoader } from "@/components/Preloader";
import { Navigate } from "react-router-dom";
import paths from "@/utils/paths";
import useQuery from "@/hooks/useQuery";
import useSimpleSSO from "@/hooks/useSimpleSSO";
import {
  fetchOidcConfig,
  loginWithKeycloak,
  markSsoAutoAttempt,
  recentSsoAutoAttempt,
} from "@/utils/keycloakAuth";

/**
 * Login page that handles both single and multi-user login.
 *
 * If Simple SSO is enabled and no login is allowed, the user will be redirected to the SSO login page
 * which may not have a token so the login will fail.
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  const query = useQuery();
  const { loading: ssoLoading, ssoConfig } = useSimpleSSO();
  const { loading, requiresAuth, mode } = usePasswordModal(!!query.get("nt"));
  const [oidcConfig, setOidcConfig] = useState(null);

  useEffect(() => {
    fetchOidcConfig()
      .then(setOidcConfig)
      .catch(() => setOidcConfig({ enabled: false }));
  }, []);

  if (loading || ssoLoading || oidcConfig === null) return <FullScreenLoader />;

  // If simple SSO is enabled and no login is allowed, redirect to the SSO login page.
  if (ssoConfig.enabled && ssoConfig.noLogin) {
    // If a noLoginRedirect is provided and no token is provided, redirect to that webpage.
    if (!!ssoConfig.noLoginRedirect && !query.has("token"))
      return window.location.replace(ssoConfig.noLoginRedirect);
    // Otherwise, redirect to the SSO login page.
    else return <Navigate to={paths.sso.login()} />;
  }

  if (requiresAuth === false) return <Navigate to={paths.home()} />;

  // Native OIDC as the default login: auto-redirect to Keycloak unless the
  // user explicitly asked for the local form (?local=1) or we just bounced
  // back from an SSO attempt (loop guard).
  if (
    oidcConfig?.enabled &&
    oidcConfig?.defaultSSO &&
    !query.get("local") &&
    !recentSsoAutoAttempt()
  ) {
    markSsoAutoAttempt();
    loginWithKeycloak();
    return <FullScreenLoader />;
  }

  return <PasswordModal mode={mode} />;
}
