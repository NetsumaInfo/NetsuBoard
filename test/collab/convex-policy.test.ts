import { describe, expect, it } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";

import {
  buildRegistrationBytes,
  type DeviceRegistrationStatement,
  verifyDeviceProof,
} from "../../convex/devices";
import {
  canInvite,
  MAX_PROJECT_MEMBERS,
  normalizeProjectRole,
} from "../../convex/projects";
import { isStaleHead } from "../../convex/collabPolicy";
import {
  checkpointCasMatches,
  isRedundantReservedUpload,
  isObsoleteEnvelopeEpoch,
  storageReservationMatches,
} from "../../convex/heads";
import { coalesceMediaHashes } from "../../convex/media";
import {
  classifySocialIdentifier,
  profileHandle,
  uniqueProfileIds,
} from "../../convex/social";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

describe("Convex collaboration policy", () => {
  it("accepts only owner/editor/viewer and only owners can invite", () => {
    expect(normalizeProjectRole("editor")).toBe("editor");
    expect(normalizeProjectRole("admin")).toBeNull();
    expect(canInvite("owner")).toBe(true);
    expect(canInvite("editor")).toBe(false);
  });

  it("keeps the project seat cap at fifteen total members", () => {
    expect(MAX_PROJECT_MEMBERS).toBe(15);
  });

  it("verifies the complete native device registration statement", async () => {
    const secret = new Uint8Array(32).fill(7);
    const signingPublic = hex(await getPublicKeyAsync(secret));
    const statement: DeviceRegistrationStatement = {
      version: 1,
      challenge: "challenge-row-id",
      accountId: "account",
      deviceId: signingPublic,
      signingPublic,
      exchangePublic: "11".repeat(32),
      endpointId: signingPublic,
    };
    const signature = await signAsync(
      buildRegistrationBytes(statement),
      secret,
    );
    expect(
      await verifyDeviceProof(
        statement,
        Buffer.from(signature).toString("base64"),
      ),
    ).toBe(true);
    expect(
      await verifyDeviceProof(
        { ...statement, accountId: "attacker" },
        Buffer.from(signature).toString("base64"),
      ),
    ).toBe(false);
  });

  it("never consumes a head whose checkpoint epoch or revision changed", () => {
    const observed = [
      { headId: "head-a", revision: 4 },
      { headId: "head-b", revision: 2 },
    ];
    expect(
      checkpointCasMatches(7, 7, observed, [{ headId: "head-a", revision: 4 }]),
    ).toBe(true);
    expect(
      checkpointCasMatches(8, 7, observed, [{ headId: "head-a", revision: 4 }]),
    ).toBe(false);
    expect(
      checkpointCasMatches(7, 7, observed, [{ headId: "head-a", revision: 5 }]),
    ).toBe(false);
  });

  it("exposes destructive head cleanup only after the full retention window", () => {
    const now = Date.UTC(2026, 7, 18);
    const retention = 30 * 24 * 60 * 60 * 1000;
    expect(isStaleHead(now - retention + 1, now)).toBe(false);
    expect(isStaleHead(now - retention, now)).toBe(true);
  });

  it("never cleans or retains storage reserved by another writer or project", () => {
    const reservation = {
      projectId: "project-a",
      userId: "alice",
      deviceId: "device-a",
      bytes: 42,
    };
    expect(storageReservationMatches(reservation, reservation)).toBe(true);
    expect(
      storageReservationMatches(reservation, {
        ...reservation,
        projectId: "project-b",
      }),
    ).toBe(false);
    expect(
      storageReservationMatches(reservation, {
        ...reservation,
        userId: "mallory",
      }),
    ).toBe(false);
    expect(
      storageReservationMatches(reservation, {
        ...reservation,
        deviceId: "device-b",
      }),
    ).toBe(false);
    expect(
      storageReservationMatches(reservation, { ...reservation, bytes: 43 }),
    ).toBe(false);
  });

  it("deletes a newly uploaded duplicate after an idempotent head retry", () => {
    expect(isRedundantReservedUpload("stored-a", "upload-b", true)).toBe(true);
    expect(isRedundantReservedUpload("stored-a", "stored-a", true)).toBe(false);
    expect(isRedundantReservedUpload("stored-a", "upload-b", false)).toBe(false);
  });

  it("keeps old key envelopes until a checkpoint uses the replacement key", () => {
    expect(isObsoleteEnvelopeEpoch(4, 4)).toBe(false);
    expect(isObsoleteEnvelopeEpoch(4, 5)).toBe(true);
    expect(isObsoleteEnvelopeEpoch(5, 5)).toBe(false);
  });

  it("coalesces repeated missing-media notices into one bounded hash set", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    expect(coalesceMediaHashes([first], [first, second])).toEqual([
      first,
      second,
    ]);
    expect(() => coalesceMediaHashes([], ["../path"])).toThrow(
      "invalid media request",
    );
    const many = Array.from({ length: 80 }, (_, index) =>
      index.toString(16).padStart(64, "0"),
    );
    expect(coalesceMediaHashes([first], many.slice(0, 64))).toHaveLength(64);
  });

  it("binds public handles to the authenticated account", () => {
    const account = "account-alice-0123456789";
    const alice = profileHandle("Same Display Name", account);
    const bob = profileHandle("Same Display Name", "account-bob-0123456789");
    expect(alice).not.toBe(bob);
    expect(profileHandle("Renamed", account).slice(-16)).toBe(alice.slice(-16));
    expect(alice.length).toBeLessThanOrEqual(64);
  });

  it("classifies every supported exact friend identifier", () => {
    expect(classifySocialIdentifier(" 1010539781551292598 ")).toEqual({
      discordId: "1010539781551292598",
      discordUsername: "1010539781551292598",
      handle: "1010539781551292598",
    });
    expect(classifySocialIdentifier("Netsuma")).toEqual({
      discordId: null,
      discordUsername: "netsuma",
      handle: "netsuma",
    });
    expect(classifySocialIdentifier("@netsuma-4jb1phz6tx8cfgcx")).toEqual({
      discordId: null,
      discordUsername: null,
      handle: "netsuma-4jb1phz6tx8cfgcx",
    });
  });

  it("deduplicates one profile and fails closed for distinct matches", () => {
    expect(
      uniqueProfileIds([
        { userId: "same" },
        { userId: "same" },
        null,
      ]),
    ).toEqual(["same"]);
    expect(
      uniqueProfileIds([{ userId: "discord-owner" }, { userId: "handle-owner" }]),
    ).toEqual(["discord-owner", "handle-owner"]);
  });
});
