import { spawn, SpawnOptions } from 'child_process'

export const run = async (command: string, args: string[], options?: SpawnOptions) => new Promise<string>((resolve, reject) => {
  const process = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true, ...options })
  const output = [] as string[]

  process.stdout.on('data', (data) => {
    output.push(data.toString().trim())
  })

  process.stderr.on('data', (data) => {
    output.push(data.toString().trim())
  })

  process.addListener('error', (error) => reject([...output, error].join('\n')))

  process.addListener('close', (code) => (code === 0 ? resolve(output.join('\n')) : reject(output.join('\n'))))
})
