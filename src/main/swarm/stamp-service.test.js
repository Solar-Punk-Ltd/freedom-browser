// Capture IPC handlers registered by the stamp service
const ipcHandlers = {};
jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => {
      ipcHandlers[channel] = handler;
    },
    removeHandler: () => {},
  },
}));

// Mock bee-js
const mockGetAllPostageBatch = jest.fn();
const mockGetStorageCost = jest.fn();
const mockBuyStorage = jest.fn();

jest.mock('@ethersphere/bee-js', () => ({
  Bee: jest.fn().mockImplementation(() => ({
    getAllPostageBatch: mockGetAllPostageBatch,
    getStorageCost: mockGetStorageCost,
    buyStorage: mockBuyStorage,
  })),
  Size: {
    fromGigabytes: jest.fn((gb) => ({ gb })),
  },
  Duration: {
    fromDays: jest.fn((days) => ({ days })),
  },
}));

jest.mock('../service-registry', () => ({
  getBeeApiUrl: jest.fn().mockReturnValue('http://127.0.0.1:1633'),
}));

jest.mock('electron-log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const { normalizeBatch, registerSwarmIpc } = require('./stamp-service');
const { Size, Duration } = require('@ethersphere/bee-js');

// Register handlers once
registerSwarmIpc();

async function invokeIpc(channel, ...args) {
  const handler = ipcHandlers[channel];
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({}, ...args);
}

// Helper to create batch objects that mimic bee-js class instances
function makeBatch(overrides = {}) {
  return {
    batchID: 'abc123',
    usable: true,
    immutableFlag: true,
    size: { toBytes: () => 5368709120 },
    remainingSize: { toBytes: () => 4000000000 },
    usage: 0.255,
    duration: { toSeconds: () => 2592000 },
    ...overrides,
  };
}

describe('stamp-service', () => {
  describe('normalizeBatch', () => {
    test('normalizes a bee-js batch using public class methods', () => {
      const batch = makeBatch({ immutableFlag: false });

      expect(normalizeBatch(batch)).toEqual({
        batchId: 'abc123',
        usable: true,
        isMutable: true,
        sizeBytes: 5368709120,
        remainingBytes: 4000000000,
        usagePercent: 26,
        ttlSeconds: 2592000,
      });
    });

    test('treats immutableFlag: true as not mutable', () => {
      const batch = makeBatch({ immutableFlag: true });
      expect(normalizeBatch(batch).isMutable).toBe(false);
    });

    test('falls back to plain numbers when class methods are absent', () => {
      const batch = {
        batchID: 'def456',
        usable: false,
        immutableFlag: true,
        size: 1000,
        remainingSize: 500,
        usage: 0.5,
        duration: 86400,
      };

      expect(normalizeBatch(batch)).toEqual({
        batchId: 'def456',
        usable: false,
        isMutable: false,
        sizeBytes: 1000,
        remainingBytes: 500,
        usagePercent: 50,
        ttlSeconds: 86400,
      });
    });

    test('handles empty/undefined fields gracefully', () => {
      const result = normalizeBatch({});
      expect(result.batchId).toBe('');
      expect(result.usable).toBe(false);
      expect(result.isMutable).toBe(false);
      expect(result.sizeBytes).toBe(0);
      expect(result.remainingBytes).toBe(0);
      expect(result.usagePercent).toBe(0);
      expect(result.ttlSeconds).toBe(0);
    });
  });

  describe('IPC handlers', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('swarm:get-stamps returns normalized batches', async () => {
      mockGetAllPostageBatch.mockResolvedValue([makeBatch()]);

      const result = await invokeIpc('swarm:get-stamps');
      expect(result.success).toBe(true);
      expect(result.stamps).toHaveLength(1);
      expect(result.stamps[0]).toEqual({
        batchId: 'abc123',
        usable: true,
        isMutable: false,
        sizeBytes: 5368709120,
        remainingBytes: 4000000000,
        usagePercent: 26,
        ttlSeconds: 2592000,
      });
    });

    test('swarm:get-stamps handles errors', async () => {
      mockGetAllPostageBatch.mockRejectedValue(new Error('Bee not reachable'));

      const result = await invokeIpc('swarm:get-stamps');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Bee not reachable');
    });

    test('swarm:get-storage-cost returns formatted xBZZ', async () => {
      mockGetStorageCost.mockResolvedValue({
        toSignificantDigits: jest.fn().mockReturnValue('0.1234'),
      });

      const result = await invokeIpc('swarm:get-storage-cost', 1, 30);
      expect(result.success).toBe(true);
      expect(result.bzz).toBe('0.1234');
      expect(Size.fromGigabytes).toHaveBeenCalledWith(1);
      expect(Duration.fromDays).toHaveBeenCalledWith(30);
    });

    test('swarm:get-storage-cost rejects zero values', async () => {
      const result = await invokeIpc('swarm:get-storage-cost', 0, 30);
      expect(result.success).toBe(false);
    });

    test('swarm:get-storage-cost rejects string values', async () => {
      const result = await invokeIpc('swarm:get-storage-cost', '1', 30);
      expect(result.success).toBe(false);
    });

    test('swarm:get-storage-cost rejects NaN', async () => {
      const result = await invokeIpc('swarm:get-storage-cost', NaN, 30);
      expect(result.success).toBe(false);
    });

    test('swarm:buy-storage returns batch ID on success', async () => {
      mockBuyStorage.mockResolvedValue('new-batch-id-hex');

      const result = await invokeIpc('swarm:buy-storage', 1, 30);
      expect(result.success).toBe(true);
      expect(result.batchId).toBe('new-batch-id-hex');
    });

    test('swarm:buy-storage handles purchase failure', async () => {
      mockBuyStorage.mockRejectedValue(new Error('insufficient BZZ balance'));

      const result = await invokeIpc('swarm:buy-storage', 1, 30);
      expect(result.success).toBe(false);
      expect(result.error).toBe('insufficient BZZ balance');
    });

    test('swarm:buy-storage rejects invalid inputs', async () => {
      const result = await invokeIpc('swarm:buy-storage', -1, 30);
      expect(result.success).toBe(false);
    });
  });
});
