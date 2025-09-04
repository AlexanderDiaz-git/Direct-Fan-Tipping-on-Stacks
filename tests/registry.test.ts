import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface User {
  id: number;
  name: string;
  role: string;
  bio: string;
  verified: boolean;
  socialLinks: string[];
  tags: string[];
  registeredAt: number;
  lastUpdated: number;
  banned: boolean;
}

interface UpdateEntry {
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
}

interface ContractState {
  contractOwner: string;
  userCounter: number;
  users: Map<string, User>;
  userUpdateHistory: Map<string, UpdateEntry[]>;
}

// Mock contract implementation
class RegistryMock {
  private state: ContractState = {
    contractOwner: "deployer",
    userCounter: 0,
    users: new Map(),
    userUpdateHistory: new Map(),
  };

  private ERR_NOT_AUTHORIZED = 200;
  private ERR_ALREADY_REGISTERED = 201;
  private ERR_INVALID_ROLE = 202;
  private ERR_BANNED = 203;
  private ERR_NOT_REGISTERED = 204;
  private MAX_SOCIAL_LINKS = 5;
  private MAX_TAGS = 10;

  private currentBlockHeight = 1000;

  registerUser(caller: string, name: string, role: string, bio: string, socialLinks: string[], tags: string[]): ClarityResponse<number> {
    if (this.state.users.has(caller)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    if (role !== "artist" && role !== "fan") {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    if (socialLinks.length > this.MAX_SOCIAL_LINKS || tags.length > this.MAX_TAGS) {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    const userId = this.state.userCounter;
    this.state.users.set(caller, {
      id: userId,
      name,
      role,
      bio,
      verified: false,
      socialLinks,
      tags,
      registeredAt: this.currentBlockHeight,
      lastUpdated: this.currentBlockHeight,
      banned: false,
    });
    this.state.userCounter += 1;
    return { ok: true, value: userId };
  }

  updateProfile(caller: string, name?: string, bio?: string, socialLinks?: string[], tags?: string[]): ClarityResponse<boolean> {
    const user = this.state.users.get(caller);
    if (!user) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (user.banned) {
      return { ok: false, value: this.ERR_BANNED };
    }
    if (socialLinks && socialLinks.length > this.MAX_SOCIAL_LINKS) {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    if (tags && tags.length > this.MAX_TAGS) {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    let history = this.state.userUpdateHistory.get(caller) ?? [];
    if (name) {
      history.push({ field: "name", oldValue: user.name, newValue: name, timestamp: this.currentBlockHeight });
      user.name = name;
    }
    if (bio) {
      history.push({ field: "bio", oldValue: user.bio, newValue: bio, timestamp: this.currentBlockHeight });
      user.bio = bio;
    }
    if (socialLinks) {
      history.push({
        field: "socialLinks",
        oldValue: JSON.stringify(user.socialLinks),
        newValue: JSON.stringify(socialLinks),
        timestamp: this.currentBlockHeight,
      });
      user.socialLinks = socialLinks;
    }
    if (tags) {
      history.push({
        field: "tags",
        oldValue: JSON.stringify(user.tags),
        newValue: JSON.stringify(tags),
        timestamp: this.currentBlockHeight,
      });
      user.tags = tags;
    }
    history = history.slice(-50);
    this.state.userUpdateHistory.set(caller, history);
    user.lastUpdated = this.currentBlockHeight;
    this.state.users.set(caller, user);
    return { ok: true, value: true };
  }

  verifyUser(caller: string, userPrincipal: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const user = this.state.users.get(userPrincipal);
    if (!user) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    user.verified = true;
    this.state.users.set(userPrincipal, user);
    return { ok: true, value: true };
  }

  banUser(caller: string, userPrincipal: string, ban: boolean): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const user = this.state.users.get(userPrincipal);
    if (!user) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    user.banned = ban;
    this.state.users.set(userPrincipal, user);
    return { ok: true, value: true };
  }

  getUser(user: string): ClarityResponse<User | undefined> {
    return { ok: true, value: this.state.users.get(user) };
  }

  getUserUpdateHistory(user: string): ClarityResponse<UpdateEntry[] | undefined> {
    return { ok: true, value: this.state.userUpdateHistory.get(user) };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user: "user",
};

describe("Registry Contract", () => {
  let contract: RegistryMock;

  beforeEach(() => {
    contract = new RegistryMock();
  });

  it("should register user successfully", () => {
    const reg = contract.registerUser(accounts.user, "TestUser", "artist", "Bio", ["link1"], ["tag1"]);
    expect(reg).toEqual({ ok: true, value: 0 });
    const user = contract.getUser(accounts.user);
    expect(user).toEqual({ ok: true, value: expect.anything() });
    if (user.ok && user.value && typeof user.value !== 'number') {
      expect(user.value.name).toBe("TestUser");
      expect(user.value.role).toBe("artist");
      expect(user.value.verified).toBe(false);
    }
  });

  it("should prevent duplicate registration", () => {
    contract.registerUser(accounts.user, "TestUser", "artist", "Bio", [], []);
    const reg = contract.registerUser(accounts.user, "Another", "fan", "Bio2", [], []);
    expect(reg).toEqual({ ok: false, value: 201 });
  });

  it("should update profile", () => {
    contract.registerUser(accounts.user, "TestUser", "artist", "OldBio", ["link1"], ["tag1"]);
    const update = contract.updateProfile(accounts.user, "NewName", "NewBio", ["link2"], ["tag2"]);
    expect(update).toEqual({ ok: true, value: true });
    const user = contract.getUser(accounts.user);
    expect(user).toEqual({ ok: true, value: expect.anything() });
    if (user.ok && user.value && typeof user.value !== 'number') {
      expect(user.value.name).toBe("NewName");
      expect(user.value.bio).toBe("NewBio");
      expect(user.value.socialLinks).toEqual(["link2"]);
      expect(user.value.tags).toEqual(["tag2"]);
    }
    const history = contract.getUserUpdateHistory(accounts.user);
    expect(history).toEqual({ ok: true, value: expect.anything() });
    if (history.ok && history.value && typeof history.value !== 'number') {
      expect(history.value.length).toBe(4); // Updated for name, bio, socialLinks, tags
      expect(history.value[0]).toEqual(
        expect.objectContaining({ field: "name", newValue: "NewName" })
      );
      expect(history.value[1]).toEqual(
        expect.objectContaining({ field: "bio", newValue: "NewBio" })
      );
      expect(history.value[2]).toEqual(
        expect.objectContaining({ field: "socialLinks", newValue: JSON.stringify(["link2"]) })
      );
      expect(history.value[3]).toEqual(
        expect.objectContaining({ field: "tags", newValue: JSON.stringify(["tag2"]) })
      );
    }
  });

  it("should verify user by owner", () => {
    contract.registerUser(accounts.user, "TestUser", "artist", "Bio", [], []);
    const verify = contract.verifyUser(accounts.deployer, accounts.user);
    expect(verify).toEqual({ ok: true, value: true });
    const user = contract.getUser(accounts.user);
    expect(user).toEqual({ ok: true, value: expect.anything() });
    if (user.ok && user.value && typeof user.value !== 'number') {
      expect(user.value.verified).toBe(true);
    }
  });

  it("should prevent non-owner from verifying", () => {
    contract.registerUser(accounts.user, "TestUser", "artist", "Bio", [], []);
    const verify = contract.verifyUser(accounts.user, accounts.user);
    expect(verify).toEqual({ ok: false, value: 200 });
  });

  it("should ban user by owner", () => {
    contract.registerUser(accounts.user, "TestUser", "artist", "Bio", [], []);
    const ban = contract.banUser(accounts.deployer, accounts.user, true);
    expect(ban).toEqual({ ok: true, value: true });
    const user = contract.getUser(accounts.user);
    expect(user).toEqual({ ok: true, value: expect.anything() });
    if (user.ok && user.value && typeof user.value !== 'number') {
      expect(user.value.banned).toBe(true);
    }
    const update = contract.updateProfile(accounts.user, "NewName");
    expect(update).toEqual({ ok: false, value: 203 });
  });
});