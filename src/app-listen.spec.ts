import { listenWithChatRuntime } from './app-listen';

const fixture = () => ({
  app: {
    listen: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  },
  guard: {
    acquireBeforeListen: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    startHealthMonitor: jest.fn<void, [() => void | Promise<void>]>(),
  },
  coordinator: { activateAfterListen: jest.fn(), deactivate: jest.fn() },
});

describe('HTTP startup and chat runtime ownership', () => {
  it('opens loopback API without acquiring the shared lock or activating chat', async () => {
    const f = fixture();
    f.guard.acquireBeforeListen.mockRejectedValue(new Error('CHAT_SINGLETON_ALREADY_ACTIVE'));
    await listenWithChatRuntime(f.app, f.guard, f.coordinator, true);
    expect(f.app.listen).toHaveBeenCalledWith(process.env.PORT ?? 3000, '127.0.0.1');
    expect(f.guard.acquireBeforeListen).not.toHaveBeenCalled();
    expect(f.guard.startHealthMonitor).not.toHaveBeenCalled();
    expect(f.coordinator.activateAfterListen).not.toHaveBeenCalled();
    expect(f.coordinator.deactivate).toHaveBeenCalledTimes(1);
    expect(f.app.close).not.toHaveBeenCalled();
  });

  it('closes local app when the HTTP port cannot be bound', async () => {
    const f = fixture();
    f.app.listen.mockRejectedValue(new Error('EADDRINUSE'));
    await expect(listenWithChatRuntime(f.app, f.guard, f.coordinator, true)).rejects.toThrow('EADDRINUSE');
    expect(f.app.close).toHaveBeenCalledTimes(1);
    expect(f.guard.acquireBeforeListen).not.toHaveBeenCalled();
    expect(f.coordinator.activateAfterListen).not.toHaveBeenCalled();
  });

  it('preserves full runtime startup order', async () => {
    const f = fixture();
    await listenWithChatRuntime(f.app, f.guard, f.coordinator, false);
    expect(f.app.listen).toHaveBeenCalledWith(process.env.PORT ?? 3000);
    expect(f.guard.acquireBeforeListen.mock.invocationCallOrder[0]).toBeLessThan(f.app.listen.mock.invocationCallOrder[0]);
    expect(f.app.listen.mock.invocationCallOrder[0]).toBeLessThan(f.coordinator.activateAfterListen.mock.invocationCallOrder[0]);
    expect(f.guard.startHealthMonitor).toHaveBeenCalledTimes(1);
  });

  it('still fails closed on singleton conflict in full runtime', async () => {
    const f = fixture();
    f.guard.acquireBeforeListen.mockRejectedValue(new Error('CHAT_SINGLETON_ALREADY_ACTIVE'));
    await expect(listenWithChatRuntime(f.app, f.guard, f.coordinator, false)).rejects.toThrow('CHAT_SINGLETON_ALREADY_ACTIVE');
    expect(f.app.listen).not.toHaveBeenCalled();
    expect(f.coordinator.activateAfterListen).not.toHaveBeenCalled();
    expect(f.guard.release).toHaveBeenCalledTimes(1);
    expect(f.app.close).toHaveBeenCalledTimes(1);
  });

  it('releases ownership on full-runtime bind failure', async () => {
    const f = fixture();
    f.app.listen.mockRejectedValue(new Error('EADDRINUSE'));
    await expect(listenWithChatRuntime(f.app, f.guard, f.coordinator, false)).rejects.toThrow('EADDRINUSE');
    expect(f.guard.release).toHaveBeenCalledTimes(1);
    expect(f.app.close).toHaveBeenCalledTimes(1);
    expect(f.coordinator.activateAfterListen).not.toHaveBeenCalled();
  });

  it('still shuts down full runtime after chat lock loss', async () => {
    const originalExitCode = process.exitCode;
    jest.useFakeTimers();
    try {
      const f = fixture();
      await listenWithChatRuntime(f.app, f.guard, f.coordinator, false);
      await f.guard.startHealthMonitor.mock.calls[0][0]();
      expect(f.coordinator.deactivate).toHaveBeenCalledTimes(1);
      expect(f.app.close).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
