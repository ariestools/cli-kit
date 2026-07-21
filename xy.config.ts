import type { XyConfig } from '@ariestools/toolchain'

const config: XyConfig = {
  compile: { node: true, validator: 'shared' },
  commands: { deplint: { classifier: 'aei-next' } },
}

export default config
