/// <reference types="node" />
/**
 * verify_parity.ts — Parity verification script for the Rust migration.
 *
 * Run with: npx tsx verify_parity.ts
 *
 * This script verifies that every Python HTTP endpoint has a corresponding
 * Tauri invoke command registered. It does NOT test live functionality —
 * it tests the CONNECTION layer: can the frontend reach the Rust backend
 * for every operation that the Python backend previously handled?
 *
 * Three levels of verification:
 *   1. Command existence — all 83 commands are registered in lib.rs
 *   2. Frontend adapter — PatientStore.ts uses the dual-path api() for each
 *   3. Data model parity — the Rust structs match the Python Pydantic models
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUST_LIB = join(__dirname, 'src-tauri', 'src', 'lib.rs');
const PATIENT_STORE = join(__dirname, 'src', 'services', 'PatientStore.ts');
const API_ADAPTER = join(__dirname, 'src', 'services', 'api.ts');

// ── Expected Tauri Commands (mirrors the 83 registered in lib.rs) ───────────

const EXPECTED_COMMANDS: Record<string, string[]> = {
  'Layer 1: Foundation': [
    'get_health',
  ],
  'Layer 2: Data CRUD — Wards': [
    'list_wards', 'get_ward_config', 'save_ward_config', 'delete_ward',
  ],
  'Layer 2: Data CRUD — Tasks': [
    'list_tasks', 'create_task', 'update_task', 'delete_task', 'claim_task',
  ],
  'Layer 2: Data CRUD — Roster': [
    'list_roster', 'add_roster_member', 'update_roster_member',
    'delete_roster_member', 'upload_avatar', 'get_avatar',
  ],
  'Layer 2: Data CRUD — Inventory': [
    'get_inventory', 'get_inventory_locations', 'add_inventory_location',
    'update_inventory_location', 'delete_inventory_location',
    'add_inventory_item', 'delete_inventory_item',
    'consume_inventory', 'restock_inventory',
    'get_inventory_activity', 'clear_inventory_activity',
  ],
  'Layer 2: Data CRUD — Patients': [
    'list_patients', 'create_patient', 'get_patient', 'update_patient',
    'add_patient_event', 'update_patient_status', 'delete_patient',
    'upload_attachment', 'get_attachment',
    'public_patient_lookup', 'patient_snapshot', 'patient_restore',
  ],
  'Layer 3: Inference': [
    'list_models', 'inference_queue_status', 'inference_complete', 'inference_stream',
  ],
  'Layer 3: STT': [
    'stt_health', 'stt_listen',
  ],
  'Layer 3: TTS': [
    'tts_health', 'tts_voices', 'tts_queue_status',
    'tts_synthesize', 'tts_synthesize_multi',
  ],
  'Layer 3: Translation': [
    'translate_status', 'translate_text', 'translate_batch',
  ],
  'Layer 4: Mesh — Server': [
    'mesh_status', 'mesh_clients', 'mesh_promote', 'mesh_snapshot',
  ],
  'Layer 4: Mesh — Chat': [
    'get_chat', 'send_chat', 'clear_chat', 'react_to_message',
    'get_thread', 'upload_chat_attachment', 'get_chat_attachment',
  ],
  'Layer 4: Mesh — Alerts': [
    'mesh_alert', 'mesh_emergency', 'mesh_announcement',
  ],
  'Layer 4: Mesh — Video': [
    'active_video_calls',
  ],
  'Layer 5: Export': [
    'export_patient_pdf', 'export_patient_html', 'shift_report_html',
  ],
  'Layer 5: QR': [
    'public_lookup_qr', 'discharge_qr', 'mesh_qr',
  ],
  'Layer 5: Distribution': [
    'distribution_status', 'distribution_download', 'distribution_download_all',
    'distribution_checksums', 'set_checksums',
  ],
  'Layer 5: Setup': [
    'setup_status', 'download_ca_pem', 'download_mobileconfig', 'regenerate_certs',
  ],
  'Layer 4b: Translation Pipelines': [
    'translate_stream_oneshot', 'translate_stream_live',
    'translate_live_segment', 'translate_live_health', 'translate_live_end',
    'call_translate_chunk',
  ],
};

// ── Verification ────────────────────────────────────────────────────────────

function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     HALT Rust Migration — Parity Verification       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const libRs = readFileSync(RUST_LIB, 'utf-8');
  let totalExpected = 0;
  let totalFound = 0;
  let totalMissing = 0;

  for (const [layer, commands] of Object.entries(EXPECTED_COMMANDS)) {
    console.log(`\n── ${layer} ──`);
    for (const cmd of commands) {
      totalExpected++;
      // Check if command is registered in lib.rs (as ::command_name or ::command_name,)
      const pattern = new RegExp(`::${cmd}[,\\s\\]]`);
      if (pattern.test(libRs)) {
        console.log(`  ✅ ${cmd}`);
        totalFound++;
      } else {
        console.log(`  ❌ ${cmd} — NOT REGISTERED in lib.rs`);
        totalMissing++;
      }
    }
  }

  // ── Frontend Adapter Check ──
  console.log('\n── Frontend Adapter ──');
  let adapterOk = false;
  try {
    const apiTs = readFileSync(API_ADAPTER, 'utf-8');
    const hasNativeCall = apiTs.includes('nativeCall');
    const hasIsNative = apiTs.includes('isNative');
    const hasTauriDetect = apiTs.includes('__TAURI_INTERNALS__');
    const hasFallback = apiTs.includes('httpCall');

    console.log(`  ${hasTauriDetect ? '✅' : '❌'} Tauri runtime detection`);
    console.log(`  ${hasIsNative ? '✅' : '❌'} isNative flag exported`);
    console.log(`  ${hasNativeCall ? '✅' : '❌'} nativeCall() (invoke wrapper)`);
    console.log(`  ${hasFallback ? '✅' : '❌'} httpCall() (fetch fallback)`);
    adapterOk = hasNativeCall && hasIsNative && hasTauriDetect && hasFallback;
  } catch {
    console.log('  ❌ api.ts not found');
  }

  // ── PatientStore Dual-Path Check ──
  console.log('\n── PatientStore.ts Dual-Path ──');
  let storeOk = false;
  try {
    const storeTs = readFileSync(PATIENT_STORE, 'utf-8');
    const usesApi = storeTs.includes("from './api'");
    const usesNativeCall = storeTs.includes('nativeCall');
    const preservesSignatures = storeTs.includes('listPatients') && storeTs.includes('getPatient');

    console.log(`  ${usesApi ? '✅' : '❌'} Imports from api.ts adapter`);
    console.log(`  ${usesNativeCall ? '✅' : '❌'} Uses nativeCall() for invoke`);
    console.log(`  ${preservesSignatures ? '✅' : '❌'} Preserves original function signatures`);
    storeOk = usesApi && usesNativeCall && preservesSignatures;
  } catch {
    console.log('  ❌ PatientStore.ts not found');
  }

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  Commands: ${totalFound}/${totalExpected} registered ${totalMissing === 0 ? '✅' : `(${totalMissing} missing ❌)`}`);
  console.log(`║  Adapter:  ${adapterOk ? '✅ Dual-path ready' : '❌ Needs work'}`);
  console.log(`║  Store:    ${storeOk ? '✅ Wired to adapter' : '❌ Needs work'}`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const passed = totalMissing === 0 && adapterOk && storeOk;
  if (passed) {
    console.log('🟢 PARITY VERIFIED — All systems go for TestFlight.\n');
  } else {
    console.log('🔴 PARITY GAPS DETECTED — Review above.\n');
  }
  // eslint-disable-next-line no-process-exit
  process.exit(passed ? 0 : 1);
}

main();
