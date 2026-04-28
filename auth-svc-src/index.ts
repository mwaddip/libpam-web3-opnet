/**
 * web3-auth-svc — OPNet ML-DSA auth service for libpam-web3.
 *
 * Self-contained HTTPS server: HTTP boilerplate (routes, TLS, body limits,
 * slowloris timeout, signal handling) is in auth-svc-common; this file
 * provides only the OPNet-specific ML-DSA verification + .sig writer.
 *
 * .sig file format (JSON):
 *   { chain: "opnet", otp, machine_id, wallet_address }
 *   wallet_address = 0x + hex(SHA256(publicKey))
 *
 * SPECIAL profile: S7 P9 E8 C5 I7 A7 L7
 *   P9: Auth boundary — validate every input, trust nothing from the network.
 *   E8: Long-running daemon — must not crash, must not leak.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@btc-vision/post-quantum/ml-dsa.js";
import {
  runServer,
  type CallbackError,
} from "../../../auth-svc-common/server";
import { chainPort } from "./chain-port";

const CHAIN_NAME = "opnet";

// ML-DSA-87 base64 ≈ 9KB. Allow a little headroom; reject everything else.
const MAX_BODY_SIZE = 9216;

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

// ── ML-DSA Parameter Tables ───────────────────────────────────────────

interface MLDSALevel {
  sigSize: number;
  verify: (sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array) => boolean;
  name: string;
}

/** Key: public key byte length. Value: expected signature size + verify function. */
const MLDSA_LEVELS: ReadonlyMap<number, MLDSALevel> = new Map([
  [1312, { sigSize: 2420, verify: ml_dsa44.verify, name: "ML-DSA-44" }],
  [1952, { sigSize: 3309, verify: ml_dsa65.verify, name: "ML-DSA-65" }],
  [2592, { sigSize: 4627, verify: ml_dsa87.verify, name: "ML-DSA-87" }],
]);

function decodeBase64(str: string): Buffer | null {
  if (!str || !BASE64_RE.test(str)) return null;
  const buf = Buffer.from(str, "base64");
  if (buf.length === 0) return null;
  return buf;
}

interface CallbackPayload {
  signature: string;
  publicKey: string;
  otp: string;
  machineId: string;
}

function parseCallbackBody(body: string): CallbackPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length !== 4) return null;
  if (typeof obj["signature"] !== "string") return null;
  if (typeof obj["publicKey"] !== "string") return null;
  if (typeof obj["otp"] !== "string") return null;
  if (typeof obj["machineId"] !== "string") return null;

  if (obj["otp"].length > 16 || obj["machineId"].length > 128) return null;

  return {
    signature: obj["signature"],
    publicKey: obj["publicKey"],
    otp: obj["otp"],
    machineId: obj["machineId"],
  };
}

interface SessionData {
  otp: string;
  machine_id: string;
}

function loadSession(sessionId: string, pendingDir: string): SessionData | null {
  const jsonPath = path.join(pendingDir, `${sessionId}.json`);
  try {
    const content = fs.readFileSync(jsonPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["otp"] !== "string" || typeof obj["machine_id"] !== "string") {
      return null;
    }
    return { otp: obj["otp"], machine_id: obj["machine_id"] };
  } catch {
    return null;
  }
}

function handleCallback(
  sessionId: string,
  body: string,
  pendingDir: string,
): CallbackError | null {
  const payload = parseCallbackBody(body);
  if (!payload) return { kind: "invalid", message: "invalid request body" };

  const sigBytes = decodeBase64(payload.signature);
  const pubKeyBytes = decodeBase64(payload.publicKey);
  if (!sigBytes) return { kind: "invalid", message: "invalid base64 in signature field" };
  if (!pubKeyBytes) return { kind: "invalid", message: "invalid base64 in publicKey field" };

  const level = MLDSA_LEVELS.get(pubKeyBytes.length);
  if (!level) {
    return {
      kind: "invalid",
      message: `unrecognized public key size: ${pubKeyBytes.length} bytes`,
    };
  }
  if (sigBytes.length !== level.sigSize) {
    return {
      kind: "invalid",
      message: `signature size ${sigBytes.length} does not match ${level.name} (expected ${level.sigSize})`,
    };
  }

  const sigPath = path.join(pendingDir, `${sessionId}.sig`);
  if (fs.existsSync(sigPath)) return { kind: "conflict" };

  const session = loadSession(sessionId, pendingDir);
  if (!session) return { kind: "not-found" };

  const otpA = Buffer.from(payload.otp);
  const otpB = Buffer.from(session.otp);
  if (otpA.length !== otpB.length || !timingSafeEqual(otpA, otpB)) {
    return { kind: "invalid", message: "otp mismatch" };
  }
  if (payload.machineId !== session.machine_id) {
    return { kind: "invalid", message: "machine_id mismatch" };
  }

  // Reconstruct signed message and double-hash per OPWallet convention:
  // signing page sends hex(SHA256(message)) to wallet.web3.signMLDSAMessage(),
  // wallet internally SHA256-hashes the hex string → signed data is
  // SHA256(hex(SHA256(message)))
  const message = `Authenticate to ${payload.machineId} with code: ${payload.otp}`;
  const messageHash = createHash("sha256").update(message).digest();
  const walletInput = messageHash.toString("hex");
  const signedHash = createHash("sha256").update(walletInput).digest();

  let isValid: boolean;
  try {
    isValid = level.verify(
      new Uint8Array(sigBytes),
      new Uint8Array(signedHash),
      new Uint8Array(pubKeyBytes),
    );
  } catch (err) {
    return {
      kind: "invalid",
      message: `${level.name} verify threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isValid) return { kind: "invalid", message: "signature verification failed" };

  const walletAddress = "0x" + createHash("sha256").update(pubKeyBytes).digest("hex");

  const sigContent = JSON.stringify({
    chain: "opnet",
    otp: payload.otp,
    machine_id: payload.machineId,
    wallet_address: walletAddress,
  });

  const tmpPath = path.join(pendingDir, `${sessionId}.sig.tmp`);
  try {
    fs.writeFileSync(tmpPath, sigContent);
    fs.renameSync(tmpPath, sigPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* tmp may not exist */ }
    return {
      kind: "invalid",
      message: `sig file write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(
    `[AUTH] Verified ${level.name} signature for session ${sessionId} → ${walletAddress}`,
  );
  return null;
}

// Only run as a server when invoked as the entry point. Test imports skip.
if (process.argv[1]?.match(/\/(auth-svc\.js|index\.ts)$/)) {
  runServer({
    chain: CHAIN_NAME,
    defaultPort: chainPort(CHAIN_NAME),
    maxBodySize: MAX_BODY_SIZE,
    requireJson: true,
    requestTimeoutMs: 5000,
    handleCallback,
  });
}
