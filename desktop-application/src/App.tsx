import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type LaunchStage = "starting" | "ready" | "failed";
type UpdateStage = "idle" | "installing" | "done" | "failed";

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  assetName?: string;
  updateAvailable: boolean;
  checked: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown startup error.";
}

function App() {
  const [stage, setStage] = useState<LaunchStage>("starting");
  const [status, setStatus] = useState("Starting BlankDrive backend...");
  const [details, setDetails] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pendingBackendUrl, setPendingBackendUrl] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateStage, setUpdateStage] = useState<UpdateStage>("idle");
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const boot = async (): Promise<void> => {
      setStage("starting");
      setStatus("Checking backend runtime...");
      setDetails("");

      try {
        const backendUrl = await invoke<string>("ensure_blankdrive_backend");
        if (cancelled) {
          return;
        }

        setStage("ready");
        setStatus("Backend online. Checking for desktop updates...");
        setDetails(backendUrl);

        let updateResult: UpdateCheckResult | null = null;
        try {
          updateResult = await invoke<UpdateCheckResult>("check_blankdrive_update");
        } catch {
          // Update checks are optional. Continue launching if check fails.
        }

        if (cancelled) {
          return;
        }

        if (updateResult?.updateAvailable) {
          setPendingBackendUrl(backendUrl);
          setUpdateInfo(updateResult);
          setStatus(
            `Desktop update ${updateResult.latestVersion || "available"} is ready to install.`
          );
          setDetails("Install now or continue with current version.");
          return;
        }

        setStatus("Backend online. Launching secure interface...");
        setDetails(backendUrl);
        window.location.replace(backendUrl);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setStage("failed");
        setStatus("Desktop launcher failed to start BlankDrive.");
        setDetails(normalizeError(error));
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const continueToWebUi = (): void => {
    if (pendingBackendUrl) {
      window.location.replace(pendingBackendUrl);
    }
  };

  const installUpdate = async (): Promise<void> => {
    if (updateStage === "installing") {
      return;
    }

    setUpdateStage("installing");
    setUpdateMessage("Downloading update and launching installer...");

    try {
      await invoke<string>("install_blankdrive_update");
      setUpdateStage("done");
      setUpdateMessage("Installer launched. Finish setup, then reopen BlankDrive Desktop.");
    } catch (error) {
      setUpdateStage("failed");
      setUpdateMessage(normalizeError(error));
    }
  };

  const badgeText = useMemo(() => {
    if (stage === "starting") {
      return "booting";
    }
    if (stage === "ready") {
      return "ready";
    }
    return "error";
  }, [stage]);

  return (
    <main className="launcher">
      <section className="panel">
        <p className={`badge badge-${stage}`}>{badgeText}</p>
        <div className="brand-row">
          <img className="brand-logo" src="/blankdrive-logo.png" alt="BlankDrive logo" />
          <div>
            <h1>BlankDrive Desktop</h1>
            <p className="brand-subtitle">Secure Vault Console</p>
          </div>
        </div>
        <p className="status">{status}</p>

        {details ? <pre className="details">{details}</pre> : null}

        {updateInfo ? (
          <section className="update-panel">
            <h2>Update Available</h2>
            <p>
              Current: <strong>{updateInfo.currentVersion}</strong> | Latest:{" "}
              <strong>{updateInfo.latestVersion || "unknown"}</strong>
            </p>
            {updateInfo.assetName ? <p>Installer: {updateInfo.assetName}</p> : null}
            {updateMessage ? <p className="update-message">{updateMessage}</p> : null}
            <div className="actions">
              <button
                type="button"
                onClick={installUpdate}
                disabled={updateStage === "installing"}
              >
                {updateStage === "installing" ? "Installing..." : "Download & Install"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={continueToWebUi}
                disabled={updateStage === "installing"}
              >
                Continue to App
              </button>
            </div>
          </section>
        ) : null}

        <div className="actions">
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={stage === "starting"}
          >
            {stage === "starting" ? "Starting..." : "Retry"}
          </button>
        </div>

        <p className="hint">
          This launcher runs your existing Node CLI in background <code>web</code> mode and opens
          the same local UI, so desktop and terminal share one backend.
        </p>
      </section>
    </main>
  );
}

export default App;
