import { spawn, SpawnOptions } from 'child_process'

export const run = async (command: string, args: string[], options?: SpawnOptions) => new Promise<string>((resolve, reject) => {
  const process = spawn(command, args, { windowsHide: true, ...options })
  const stdout = [] as string[]
  const stderr = [] as string[]

  process.stdout.on('data', (data) => {
    stdout.push(data.toString().trim())
  })

  process.stderr.on('data', (data) => {
    stderr.push(data.toString().trim())
  })

  process.addListener('error', (error) => reject([...stderr, error].join('\n')))

  process.addListener('close', (code) => (code === 0 ? resolve(stdout.join('\n')) : reject(stderr.join('\n'))))
})
