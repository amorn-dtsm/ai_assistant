import { createContext, useEffect, useState } from "react";
import AnythingLLM from "./media/logo/anything-llm.png";
import AnythingLLMDark from "./media/logo/anything-llm-dark.png";
import DefaultLoginLogoLight from "./media/illustrations/login-logo.svg";
import DefaultLoginLogoDark from "./media/illustrations/login-logo-light.svg";
import System from "./models/system";

export const REFETCH_LOGO_EVENT = "refetch-logo";

function isLightMode() {
  return document.documentElement.getAttribute("data-theme") === "light";
}

function isGreenMode() {
  return document.documentElement.getAttribute("data-theme") === "green";
}

export const LogoContext = createContext();

export function LogoProvider({ children }) {
  const [logo, setLogo] = useState("");
  const [contentLogo, setContentLogo] = useState("");
  const [loginLogo, setLoginLogo] = useState("");
  const [isCustomLogo, setIsCustomLogo] = useState(false);

  async function fetchInstanceLogo() {
    const DefaultLoginLogo = isLightMode()
      ? DefaultLoginLogoDark
      : DefaultLoginLogoLight;
    try {
      const { isCustomLogo, logoURL } = await System.fetchLogo();
      if (logoURL) {
        setLogo(logoURL);
        setContentLogo(logoURL);
        setLoginLogo(isCustomLogo ? logoURL : DefaultLoginLogo);
        setIsCustomLogo(isCustomLogo);
      } else {
        // logo (sidebar): light → dark variant; dark/green → white variant
        isLightMode() ? setLogo(AnythingLLMDark) : setLogo(AnythingLLM);
        // contentLogo (content area): light/green → dark variant; dark → white variant
        isLightMode() || isGreenMode()
          ? setContentLogo(AnythingLLMDark)
          : setContentLogo(AnythingLLM);
        setLoginLogo(DefaultLoginLogo);
        setIsCustomLogo(false);
      }
    } catch (err) {
      isLightMode() ? setLogo(AnythingLLMDark) : setLogo(AnythingLLM);
      isLightMode() || isGreenMode()
        ? setContentLogo(AnythingLLMDark)
        : setContentLogo(AnythingLLM);
      setLoginLogo(DefaultLoginLogo);
      setIsCustomLogo(false);
      console.error("Failed to fetch logo:", err);
    }
  }

  useEffect(() => {
    fetchInstanceLogo();
    window.addEventListener(REFETCH_LOGO_EVENT, fetchInstanceLogo);
    return () => {
      window.removeEventListener(REFETCH_LOGO_EVENT, fetchInstanceLogo);
    };
  }, []);

  return (
    <LogoContext.Provider
      value={{ logo, setLogo, contentLogo, loginLogo, isCustomLogo }}
    >
      {children}
    </LogoContext.Provider>
  );
}
