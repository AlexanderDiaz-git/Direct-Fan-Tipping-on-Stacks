import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Tip {
  tipper: string;
  artist: string;
  amount: number;
  token?: string;
  timestamp: number;
  refunded: boolean;
}

interface TippingEvent {
  artist: string;
  startHeight: number;
  endHeight: number;
  totalTipped: number;
}

interface ContractState {
  contractOwner: string;
  paused: boolean;
  minTipAmount: number;
  platformFeePercent: number;
  tips: Map<number, Tip>;
  tipHistoryByTipper: Map<string, number[]>;
  tipHistoryByArtist: Map<string, number[]>;
  totalTipsReceived: Map<string, number>;
  totalTipsSent: Map<string, number>;
  tipCounter: number;
  tippingEvents: Map<number, TippingEvent>;
  eventCounter: number;
  stxBalances: Map<string, number>;
  tokenBalances: Map<string, Map<string, number>>;
}

// Mock registry trait
class MockRegistry {
  users: Map<string, { name: string; role: string; registeredAt: number }> = new Map();

  getUser(user: string): ClarityResponse<{ name: string; role: string; registeredAt: number } | null> {
    const info = this.users.get(user);
    return { ok: true, value: info ?? null };
  }
}

// Mock FT trait
class MockFT {
  tokenPrincipal: string;
  balances: Map<string, number>;

  constructor(tokenPrincipal: string, balances: Map<string, number>) {
    this.tokenPrincipal = tokenPrincipal;
    this.balances = balances;
  }

  transfer(amount: number, sender: string, recipient: string): ClarityResponse<boolean> {
    const senderBal = this.balances.get(sender) ?? 0;
    if (senderBal < amount) {
      return { ok: false, value: 103 };
    }
    this.balances.set(sender, senderBal - amount);
    const recipBal = this.balances.get(recipient) ?? 0;
    this.balances.set(recipient, recipBal + amount);
    return { ok: true, value: true };
  }
}

// Mock contract implementation
class TippingMock {
  private state: ContractState = {
    contractOwner: "deployer",
    paused: false,
    minTipAmount: 100,
    platformFeePercent: 5,
    tips: new Map(),
    tipHistoryByTipper: new Map(),
    tipHistoryByArtist: new Map(),
    totalTipsReceived: new Map(),
    totalTipsSent: new Map(),
    tipCounter: 0,
    tippingEvents: new Map(),
    eventCounter: 0,
    stxBalances: new Map([["tipper", 1000000], ["deployer", 0]]),
    tokenBalances: new Map(),
  };

  private ERR_NOT_REGISTERED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_NOT_AUTHORIZED = 102;
  private ERR_INSUFFICIENT_BALANCE = 103;
  private ERR_TIP_NOT_FOUND = 104;
  private ERR_REFUND_NOT_ALLOWED = 105;
  private ERR_PAUSED = 106;
  private ERR_BATCH_LIMIT_EXCEEDED = 108;
  private MAX_BATCH_SIZE = 10;

  private currentBlockHeight = 1000;

  advanceBlock(): void {
    this.currentBlockHeight += 1;
  }

  setTokenBalances(tokenPrincipal: string, balances: Map<string, number>): void {
    this.state.tokenBalances.set(tokenPrincipal, balances);
  }

  setPaused(caller: string, newPaused: boolean): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = newPaused;
    return { ok: true, value: true };
  }

  setMinTipAmount(caller: string, newMin: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.minTipAmount = newMin;
    return { ok: true, value: true };
  }

  setPlatformFeePercent(caller: string, newPercent: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (newPercent > 100) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.platformFeePercent = newPercent;
    return { ok: true, value: true };
  }

  sendTipStx(caller: string, artist: string, amount: number, registry: MockRegistry): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const artistInfo = registry.getUser(artist);
    if (!artistInfo.ok || !artistInfo.value || artistInfo.value.role !== "artist") {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (amount < this.state.minTipAmount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const tipperBal = this.state.stxBalances.get(caller) ?? 0;
    if (tipperBal < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    const fee = Math.floor((amount * this.state.platformFeePercent) / 1000);
    const netAmount = amount - fee;
    this.state.stxBalances.set(caller, tipperBal - amount);
    const ownerBal = this.state.stxBalances.get(this.state.contractOwner) ?? 0;
    this.state.stxBalances.set(this.state.contractOwner, ownerBal + fee);
    const artistBal = this.state.stxBalances.get(artist) ?? 0;
    this.state.stxBalances.set(artist, artistBal + netAmount);

    const tipId = this.state.tipCounter;
    this.state.tips.set(tipId, { tipper: caller, artist, amount, timestamp: this.currentBlockHeight, refunded: false });
    const tipperHistory = this.state.tipHistoryByTipper.get(caller) ?? [];
    tipperHistory.push(tipId);
    this.state.tipHistoryByTipper.set(caller, tipperHistory.slice(-100));
    const artistHistory = this.state.tipHistoryByArtist.get(artist) ?? [];
    artistHistory.push(tipId);
    this.state.tipHistoryByArtist.set(artist, artistHistory.slice(-100));
    const totalReceived = this.state.totalTipsReceived.get(artist) ?? 0;
    this.state.totalTipsReceived.set(artist, totalReceived + netAmount);
    const totalSent = this.state.totalTipsSent.get(caller) ?? 0;
    this.state.totalTipsSent.set(caller, totalSent + amount);
    this.state.tipCounter += 1;
    return { ok: true, value: tipId };
  }

  sendTipToken(caller: string, artist: string, amount: number, token: MockFT, registry: MockRegistry): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const artistInfo = registry.getUser(artist);
    if (!artistInfo.ok || !artistInfo.value || artistInfo.value.role !== "artist") {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (amount < this.state.minTipAmount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const tokenBalances = this.state.tokenBalances.get(token.tokenPrincipal) ?? new Map();
    const tipperBal = tokenBalances.get(caller) ?? 0;
    if (tipperBal < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    const fee = Math.floor((amount * this.state.platformFeePercent) / 1000);
    const netAmount = amount - fee;
    tokenBalances.set(caller, tipperBal - amount);
    const ownerBal = tokenBalances.get(this.state.contractOwner) ?? 0;
    tokenBalances.set(this.state.contractOwner, ownerBal + fee);
    const artistBal = tokenBalances.get(artist) ?? 0;
    tokenBalances.set(artist, artistBal + netAmount);
    this.state.tokenBalances.set(token.tokenPrincipal, tokenBalances);

    const tipId = this.state.tipCounter;
    this.state.tips.set(tipId, { tipper: caller, artist, amount, token: token.tokenPrincipal, timestamp: this.currentBlockHeight, refunded: false });
    const tipperHistory = this.state.tipHistoryByTipper.get(caller) ?? [];
    tipperHistory.push(tipId);
    this.state.tipHistoryByTipper.set(caller, tipperHistory.slice(-100));
    const artistHistory = this.state.tipHistoryByArtist.get(artist) ?? [];
    artistHistory.push(tipId);
    this.state.tipHistoryByArtist.set(artist, artistHistory.slice(-100));
    const totalReceived = this.state.totalTipsReceived.get(artist) ?? 0;
    this.state.totalTipsReceived.set(artist, totalReceived + netAmount);
    const totalSent = this.state.totalTipsSent.get(caller) ?? 0;
    this.state.totalTipsSent.set(caller, totalSent + amount);
    this.state.tipCounter += 1;
    return { ok: true, value: tipId };
  }

  batchSendTipStx(caller: string, artists: string[], amounts: number[], registry: MockRegistry): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (artists.length > this.MAX_BATCH_SIZE || artists.length !== amounts.length) {
      return { ok: false, value: this.ERR_BATCH_LIMIT_EXCEEDED };
    }
    let success = true;
    for (let i = 0; i < artists.length; i++) {
      const res = this.sendTipStx(caller, artists[i], amounts[i], registry);
      if (!res.ok) {
        success = false;
        break;
      }
    }
    return { ok: success, value: success };
  }

  refundTip(caller: string, tipId: number): ClarityResponse<boolean> {
    const tip = this.state.tips.get(tipId);
    if (!tip) {
      return { ok: false, value: this.ERR_TIP_NOT_FOUND };
    }
    if (caller !== tip.tipper || tip.refunded || this.currentBlockHeight >= tip.timestamp + 144) {
      return { ok: false, value: this.ERR_REFUND_NOT_ALLOWED };
    }
    const fee = Math.floor((tip.amount * this.state.platformFeePercent) / 1000);
    const netAmount = tip.amount - fee;
    if (!tip.token) {
      const artistBal = this.state.stxBalances.get(tip.artist) ?? 0;
      this.state.stxBalances.set(tip.artist, artistBal - netAmount);
      const tipperBal = this.state.stxBalances.get(caller) ?? 0;
      this.state.stxBalances.set(caller, tipperBal + netAmount);
    } else {
      const tokenBalances = this.state.tokenBalances.get(tip.token) ?? new Map();
      const artistBal = tokenBalances.get(tip.artist) ?? 0;
      tokenBalances.set(tip.artist, artistBal - netAmount);
      const tipperBal = tokenBalances.get(caller) ?? 0;
      tokenBalances.set(caller, tipperBal + netAmount);
      this.state.tokenBalances.set(tip.token, tokenBalances);
    }
    tip.refunded = true;
    this.state.tips.set(tipId, tip);
    const totalReceived = this.state.totalTipsReceived.get(tip.artist) ?? 0;
    this.state.totalTipsReceived.set(tip.artist, totalReceived - netAmount);
    const totalSent = this.state.totalTipsSent.get(tip.tipper) ?? 0;
    this.state.totalTipsSent.set(tip.tipper, totalSent - tip.amount);
    return { ok: true, value: true };
  }

  createTippingEvent(caller: string, artist: string, duration: number, registry: MockRegistry): ClarityResponse<number> {
    const artistInfo = registry.getUser(artist);
    if (!artistInfo.ok || !artistInfo.value || artistInfo.value.role !== "artist") {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (caller !== artist) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const eventId = this.state.eventCounter;
    this.state.tippingEvents.set(eventId, { artist, startHeight: this.currentBlockHeight, endHeight: this.currentBlockHeight + duration, totalTipped: 0 });
    this.state.eventCounter += 1;
    return { ok: true, value: eventId };
  }

  getTip(tipId: number): ClarityResponse<Tip | undefined> {
    return { ok: true, value: this.state.tips.get(tipId) };
  }

  getTipHistoryByTipper(tipper: string): ClarityResponse<number[] | undefined> {
    return { ok: true, value: this.state.tipHistoryByTipper.get(tipper) };
  }

  getTipHistoryByArtist(artist: string): ClarityResponse<number[] | undefined> {
    return { ok: true, value: this.state.tipHistoryByArtist.get(artist) };
  }

  getTotalTipsReceived(artist: string): ClarityResponse<number> {
    return { ok: true, value: this.state.totalTipsReceived.get(artist) ?? 0 };
  }

  getTotalTipsSent(tipper: string): ClarityResponse<number> {
    return { ok: true, value: this.state.totalTipsSent.get(tipper) ?? 0 };
  }

  getTippingEvent(eventId: number): ClarityResponse<TippingEvent | undefined> {
    return { ok: true, value: this.state.tippingEvents.get(eventId) };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getMinTipAmount(): ClarityResponse<number> {
    return { ok: true, value: this.state.minTipAmount };
  }

  getPlatformFeePercent(): ClarityResponse<number> {
    return { ok: true, value: this.state.platformFeePercent };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  tipper: "tipper",
  artist: "artist",
  anotherArtist: "anotherArtist",
};

describe("Tipping Contract", () => {
  let contract: TippingMock;
  let registry: MockRegistry;

  beforeEach(() => {
    contract = new TippingMock();
    registry = new MockRegistry();
    registry.users.set(accounts.artist, { name: "Artist", role: "artist", registeredAt: 100 });
    registry.users.set(accounts.anotherArtist, { name: "Another", role: "artist", registeredAt: 100 });
  });

  it("should allow owner to pause and unpause", () => {
    const pause = contract.setPaused(accounts.deployer, true);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const unpause = contract.setPaused(accounts.deployer, false);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-owner from pausing", () => {
    const pause = contract.setPaused(accounts.tipper, true);
    expect(pause).toEqual({ ok: false, value: 102 });
  });

  it("should send STX tip successfully", () => {
    const tip = contract.sendTipStx(accounts.tipper, accounts.artist, 1000, registry);
    expect(tip).toEqual({ ok: true, value: 0 });
    expect(contract.getTotalTipsSent(accounts.tipper)).toEqual({ ok: true, value: 1000 });
    expect(contract.getTotalTipsReceived(accounts.artist)).toEqual({ ok: true, value: 995 });
    expect(contract.getTipHistoryByTipper(accounts.tipper)).toEqual({ ok: true, value: [0] });
    expect(contract.getTipHistoryByArtist(accounts.artist)).toEqual({ ok: true, value: [0] });
  });

  it("should prevent tip below min amount", () => {
    const tip = contract.sendTipStx(accounts.tipper, accounts.artist, 50, registry);
    expect(tip).toEqual({ ok: false, value: 101 });
  });

  it("should send token tip successfully", () => {
    const tokenBalances = new Map([[accounts.tipper, 1000000], [accounts.deployer, 0]]);
    const mockToken = new MockFT("token-principal", tokenBalances);
    contract.setTokenBalances("token-principal", tokenBalances);

    const tip = contract.sendTipToken(accounts.tipper, accounts.artist, 1000, mockToken, registry);
    expect(tip).toEqual({ ok: true, value: 0 });
    expect(contract.getTotalTipsSent(accounts.tipper)).toEqual({ ok: true, value: 1000 });
    expect(contract.getTotalTipsReceived(accounts.artist)).toEqual({ ok: true, value: 995 });
  });

  it("should batch send STX tips", () => {
    const batch = contract.batchSendTipStx(accounts.tipper, [accounts.artist, accounts.anotherArtist], [500, 500], registry);
    expect(batch).toEqual({ ok: true, value: true });
    expect(contract.getTotalTipsSent(accounts.tipper)).toEqual({ ok: true, value: 1000 });
    expect(contract.getTotalTipsReceived(accounts.artist)).toEqual({ ok: true, value: 498 });
  });

  it("should refund tip within window", () => {
    contract.sendTipStx(accounts.tipper, accounts.artist, 1000, registry);
    const refund = contract.refundTip(accounts.tipper, 0);
    expect(refund).toEqual({ ok: true, value: true });
    expect(contract.getTotalTipsReceived(accounts.artist)).toEqual({ ok: true, value: 0 });
    const tip = contract.getTip(0);
    expect(tip).toEqual({ ok: true, value: expect.objectContaining({ refunded: true }) });
  });

  it("should prevent refund after window", () => {
    contract.sendTipStx(accounts.tipper, accounts.artist, 1000, registry);
    for (let i = 0; i < 145; i++) {
      contract.advanceBlock();
    }
    const refund = contract.refundTip(accounts.tipper, 0);
    expect(refund).toEqual({ ok: false, value: 105 });
  });

  it("should create tipping event", () => {
    const event = contract.createTippingEvent(accounts.artist, accounts.artist, 100, registry);
    expect(event).toEqual({ ok: true, value: 0 });
    expect(contract.getTippingEvent(0)).toEqual({ ok: true, value: { artist: accounts.artist, startHeight: 1000, endHeight: 1100, totalTipped: 0 } });
  });

  it("should prevent non-artist from creating event", () => {
    const event = contract.createTippingEvent(accounts.tipper, accounts.artist, 100, registry);
    expect(event).toEqual({ ok: false, value: 102 });
  });
});