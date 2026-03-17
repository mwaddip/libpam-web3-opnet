/**
 * Signing page engine — OPNet ML-DSA authentication via OPWallet.
 *
 * Self-initializes on DOMContentLoaded. Reads configuration from the global
 * CONFIG object (injected by the generator/server). Finds required DOM
 * elements by ID per the page template interface contract.
 *
 * Required DOM element IDs:
 *   btn-connect, btn-sign, wallet-address, status-message,
 *   step-connect, step-sign
 *
 * CSS classes toggled by this bundle:
 *   hidden, active, completed, disabled, loading, error, success
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
    return hex;
  }

  function hexToBytes(hex) {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }

  function uint8ToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // ── Status management ───────────────────────────────────────────────

  function setStatus(msg, type) {
    var el = $('status-message');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden', 'error', 'success');
    if (type) el.classList.add(type);
    if (!msg) el.classList.add('hidden');
  }

  function clearStatus() {
    var el = $('status-message');
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('error', 'success');
  }

  // ── Step state management ───────────────────────────────────────────

  function activateStep(stepId) {
    var el = $(stepId);
    if (!el) return;
    el.classList.remove('hidden', 'completed');
    el.classList.add('active');
  }

  function completeStep(stepId) {
    var el = $(stepId);
    if (!el) return;
    el.classList.remove('active', 'hidden');
    el.classList.add('completed');
  }

  // ── Button state ────────────────────────────────────────────────────

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.classList.add('loading', 'disabled');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading', 'disabled');
      btn.disabled = false;
    }
  }

  // ── OPWallet detection ──────────────────────────────────────────────

  function getWallet() {
    if (!window.opnet) return null;
    var w = window.opnet;
    if (typeof w.requestAccounts === 'function' && w.web3) return w;
    return null;
  }

  // ── Main logic ──────────────────────────────────────────────────────

  function init() {
    var btnConnect = $('btn-connect');
    var btnSign = $('btn-sign');
    var walletAddress = $('wallet-address');

    // Parse session ID from URL query string
    var sessionId = (new URLSearchParams(window.location.search)).get('session');

    if (!sessionId) {
      setStatus('No session. Use the link from your terminal.', 'error');
      if (btnConnect) {
        btnConnect.disabled = true;
        btnConnect.classList.add('disabled');
      }
      return;
    }

    // Initial step state
    activateStep('step-connect');

    // Session data (populated after wallet connect)
    var otp = '';
    var machineId = '';

    function loadSession() {
      fetch('/auth/pending/' + sessionId).then(function (res) {
        if (!res.ok) { setStatus('Session not found or expired', 'error'); return; }
        return res.json();
      }).then(function (data) {
        if (!data) return;
        otp = data.otp || '';
        machineId = data.machine_id || '';
        // Populate visible fields if the template provides them
        var codeEl = $('code');
        var machineEl = $('machine');
        if (codeEl) codeEl.value = otp;
        if (machineEl) machineEl.value = machineId;
      }).catch(function () {
        setStatus('Failed to load session', 'error');
      });
    }

    function connect() {
      var w = getWallet();
      if (!w) {
        setStatus('No OPWallet found. Install the OPWallet extension.', 'error');
        return;
      }

      setButtonLoading(btnConnect, true);

      w.requestAccounts().then(function (accs) {
        if (!accs || !accs.length) {
          setStatus('No accounts returned', 'error');
          setButtonLoading(btnConnect, false);
          return;
        }

        if (walletAddress) walletAddress.textContent = accs[0];
        completeStep('step-connect');
        activateStep('step-sign');
        clearStatus();
        loadSession();
      }).catch(function () {
        setStatus('Connection rejected', 'error');
        setButtonLoading(btnConnect, false);
      });
    }

    function sign() {
      var w = getWallet();
      if (!w) { setStatus('Wallet disconnected', 'error'); return; }
      if (!otp || !machineId) { setStatus('Session data incomplete', 'error'); return; }

      var msg = 'Authenticate to ' + machineId + ' with code: ' + otp;

      setButtonLoading(btnSign, true);

      // SHA256 hash the message, then hex-encode for the wallet API.
      // The wallet internally SHA256-hashes whatever string it receives,
      // so the actual signed data is SHA256(messageHex).
      var msgBytes = new TextEncoder().encode(msg);
      crypto.subtle.digest('SHA-256', msgBytes).then(function (hashBuf) {
        var messageHex = bytesToHex(new Uint8Array(hashBuf));
        return w.web3.signMLDSAMessage(messageHex);
      }).then(function (signed) {
        // signed.signature and signed.publicKey are hex strings.
        // auth-svc expects base64-encoded raw bytes for sig/pubkey.
        var payload = JSON.stringify({
          signature: uint8ToBase64(hexToBytes(signed.signature)),
          publicKey: uint8ToBase64(hexToBytes(signed.publicKey)),
          otp: otp,
          machineId: machineId,
        });

        return fetch('/auth/callback/' + sessionId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      }).then(function (cb) {
        if (cb.ok) {
          completeStep('step-sign');
          setStatus('Signature sent! Press Enter in your terminal.', 'success');
        } else {
          setStatus('Server rejected the signature (' + cb.status + ')', 'error');
        }
      }).catch(function (e) {
        setStatus('Signing failed: ' + (e.message || e), 'error');
      }).finally(function () {
        setButtonLoading(btnSign, false);
      });
    }

    if (btnConnect) btnConnect.onclick = connect;
    if (btnSign) btnSign.onclick = sign;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
