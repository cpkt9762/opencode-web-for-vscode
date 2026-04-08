type Sdk = import("@opencode-ai/sdk/v2/client", { with: { "resolution-mode": "import" } }).OpencodeClient
type Base = import("@opencode-ai/sdk/v2/client", { with: { "resolution-mode": "import" } }).OpencodeClientConfig
type Make = (cfg?: Base & { directory?: string; experimental_workspaceID?: string }) => Sdk

class ClientWithConfig {
  client: Sdk
  url: string
  auth: string

  constructor(client: Sdk, url: string, auth: string) {
    this.client = client
    this.url = url
    this.auth = auth
  }
}

let createOpencodeClient: Make | null = null

async function getSDK(): Promise<Make> {
  if (createOpencodeClient) return createOpencodeClient

  const mod = await import("@opencode-ai/sdk/v2")
  createOpencodeClient = mod.createOpencodeClient
  return createOpencodeClient
}

export async function createClient(opts: {
  url: string
  password: string
  directory: string
}): Promise<ClientWithConfig> {
  const createOC = await getSDK()
  const auth = `Basic ${btoa(`opencode:${opts.password}`)}`

  const client = createOC({
    baseUrl: opts.url,
    directory: opts.directory,
    headers: {
      Authorization: auth,
    },
  })

  return new ClientWithConfig(client, opts.url, auth)
}

export async function updateDirectory(cfg: ClientWithConfig, dir: string): Promise<ClientWithConfig> {
  const createOC = await getSDK()
  const client = createOC({
    baseUrl: cfg.url,
    directory: dir,
    headers: {
      Authorization: cfg.auth,
    },
  })

  return new ClientWithConfig(client, cfg.url, cfg.auth)
}
