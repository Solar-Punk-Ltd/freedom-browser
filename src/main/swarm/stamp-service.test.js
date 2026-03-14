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
    fromGigabytes: jest.fn((gb) => ({ gb, bytes: gb * 1024 * 1024 * 1024 })),
  },
  Duration: {
    fromDays: jest.fn((days) => ({ days, seconds: days * 86400 })),
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

describe('stamp-service', () => {
  describe('normalizeBatch', () => {
    test('normalizes a bee-js batch to the Freedom batch model', () => {
      const raw = {
        batchID: 'abc123',
        usable: true,
        immutableFlag: false,
        size: { bytes: 5368709120 },
        remainingSize: { bytes: 4000000000 },
        usage: 0.255,
        duration: 2592000,
      };

      expect(normalizeBatch(raw)).toEqual({
        batchId: 'abc123',
        usable: true,
        isMutable: true,
        sizeBytes: 5368709120,
        remainingBytes: 4000000000,
        usagePercent: 26,
        ttlSeconds: 2592000,
      });
    });

    test('handles missing or numeric size fields', () => {
      const raw = {
        batchID: 'def456',
        usable: false,
        size: 1000,
        remainingSize: 500,
        usage: 0.5,
        duration: 86400,
      };

      expect(normalizeBatch(raw)).toEqual({
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
      mockGetAllPostageBatch.mockResolvedValue([
        {
          batchID: 'batch1',
          usable: true,
          immutableFlag: true,
          size: { bytes: 1073741824 },
          remainingSize: { bytes: 800000000 },
          usage: 0.25,
          duration: 604800,
        },
      ]);

      const result = await invokeIpc('swarm:get-stamps');
      expect(result.success).toBe(true);
      expect(result.stamps).toHaveLength(1);
      expect(result.stamps[0]).toEqual({
        batchId: 'batch1',
        usable: true,
        isMutable: false,
        sizeBytes: 1073741824,
        remainingBytes: 800000000,
        usagePercent: 25,
        ttlSeconds: 604800,
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

    test('swarm:get-storage-cost rejects invalid inputs', async () => {
      const result = await invokeIpc('swarm:get-storage-cost', 0, 30);
      expect(result.success).toBe(false);
      expect(result.error).toContain('positive');
    });

    test('swarm:buy-storage returns batch ID on success', async () => {
      mockBuyStorage.mockResolvedValue('new-batch-id-hex');

      const result = await invokeIpc('swarm:buy-storage', 1, 30);
      expect(result.success).toBe(true);
      expect(result.batchId).toBe('new-batch-id-hex');
      expect(Size.fromGigabytes).toHaveBeenCalledWith(1);
      expect(Duration.fromDays).toHaveBeenCalledWith(30);
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
      expect(result.error).toContain('positive');
    });
  });
});
