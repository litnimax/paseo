import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Odusphere.app/Contents/MacOS/Odusphere",
        shimPath: "/Applications/Odusphere.app/Contents/Resources/bin/paseo",
      }),
    ).toBe("/Applications/Odusphere.app/Contents/Resources/bin/paseo");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_paseo123/paseo",
        shimPath: "/tmp/.mount_paseo123/resources/bin/paseo",
        appImagePath: "/home/user/Applications/Odusphere.AppImage",
      }),
    ).toBe("/home/user/Applications/Odusphere.AppImage");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Odusphere/Odusphere",
        shimPath: "/opt/Odusphere/resources/bin/paseo",
      }),
    ).toBe("/opt/Odusphere/resources/bin/paseo");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Paseo\\Odusphere.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Paseo\\resources\\bin\\paseo.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Paseo\\resources\\bin\\paseo.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Odusphere/paseo",
        shimPath: "/opt/Odusphere/resources/bin/paseo",
      }),
    ).toBe("/opt/Odusphere/resources/bin/paseo");
  });
});
