// First-run setup calls. These work without signing in, but only until setup is finished.
import { defaultServer, isDemo } from './api';
import { demo } from './demo';

export interface PublicInfo {
  ServerName: string;
  Version: string;
  StartupWizardCompleted: boolean;
}

export interface FsEntry {
  Name: string;
  Path: string;
  Type: string;
}

const H = {
  Authorization: 'MediaBrowser Client="ReelForge", Device="Browser", DeviceId="reelforge-setup", Version="0.2.0"',
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isDemo) return demo.handle(method, path, body) as Promise<T>;
  const res = await fetch(`${defaultServer()}${path}`, {
    method,
    headers: { ...H, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const setup = {
  info: () => call<PublicInfo>('GET', '/System/Info/Public'),
  defaults: () => call<{ ServerName: string; UICulture: string; MetadataCountryCode: string; PreferredMetadataLanguage: string }>('GET', '/Startup/Configuration'),
  saveConfig: (c: { ServerName: string; UICulture: string; MetadataCountryCode: string; PreferredMetadataLanguage: string }) =>
    call('POST', '/Startup/Configuration', c),
  firstUser: () => call<{ Name: string }>('GET', '/Startup/User'),
  saveUser: (Name: string, Password: string) => call('POST', '/Startup/User', { Name, Password }),
  drives: () => call<FsEntry[]>('GET', '/Environment/Drives'),
  folders: (path: string) =>
    call<FsEntry[]>('GET', `/Environment/DirectoryContents?path=${encodeURIComponent(path)}&includeDirectories=true&includeFiles=false`),
  parent: (path: string) => call<string | null>('GET', `/Environment/ParentPath?path=${encodeURIComponent(path)}`),
  validate: (Path: string) => call('POST', '/Environment/ValidatePath', { Path, ValidateWritable: false, IsFile: false }),
  addLibrary: (name: string, collectionType: string, paths: string[]) =>
    call('POST', `/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${collectionType}&refreshLibrary=false`, {
      LibraryOptions: {
        PathInfos: paths.map((Path) => ({ Path })),
        EnableRealtimeMonitor: true,
        EnablePhotos: true,
        SaveLocalMetadata: false,
      },
    }),
  remoteAccess: (enable: boolean) => call('POST', '/Startup/RemoteAccess', { EnableRemoteAccess: enable, EnableAutomaticPortMapping: false }),
  complete: () => call('POST', '/Startup/Complete'),
};
