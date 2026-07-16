import { useEffect, useState } from "react";

import { GeneralSettings } from "@/options/components/GeneralSettings";
import { PrivacyNotice } from "@/options/components/PrivacyNotice";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { UserSettings } from "@/shared/settings-types";

export interface OptionsApi {
  getSettings(): Promise<UserSettings>;
  updateSettings(update: Partial<UserSettings>): Promise<UserSettings>;
}

const defaultOptionsApi = createChromeOptionsApi();

export function App({ api = defaultOptionsApi }: { api?: OptionsApi }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => setError("Não foi possível carregar as configurações."));
  }, [api]);

  const update = (change: Partial<UserSettings>) => {
    void api
      .updateSettings(change)
      .then((updated) => {
        setSettings(updated);
        setError(null);
      })
      .catch(() => setError("A configuração informada não é válida."));
  };

  return (
    <main>
      <h1>CleanFeed AI</h1>
      <GeneralSettings settings={settings} onUpdate={update} />
      <PrivacyNotice />
      {error === null ? null : <p role="alert">{error}</p>}
    </main>
  );
}

export function createChromeOptionsApi(): OptionsApi {
  return {
    async getSettings() {
      const response = await chrome.runtime.sendMessage({
        source: "options",
        target: "background",
        type: "GET_SETTINGS",
        payload: undefined,
      });
      const message = parseExtensionMessage(response);
      if (message.type !== "SETTINGS_RESULT")
        throw new Error("SETTINGS_UNAVAILABLE");
      return message.payload;
    },
    async updateSettings(update) {
      const response = await chrome.runtime.sendMessage({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: update,
      });
      const message = parseExtensionMessage(response);
      if (message.type !== "SETTINGS_RESULT")
        throw new Error("SETTINGS_UNAVAILABLE");
      return message.payload;
    },
  };
}
