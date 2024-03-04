import { freeze } from 'immer'

export type ChainHandler<Input = unknown, Output = unknown> = (
  input: Input
) => Promise<Output>

export type Next = (input: unknown) => Promise<unknown>

export type AnonymousMiddleware<Input = unknown> = (
  next: Next
) => ChainHandler<Input>

export type NamedMiddleware<Input = unknown> = [
  string,
  AnonymousMiddleware<Input>
]

export type Middleware<Input = unknown> =
  | AnonymousMiddleware<Input>
  | NamedMiddleware<Input>

export type PipelineModifications<Input = unknown> =
  | ['before' | 'after' | 'replace', name: string, Middleware<Input>]
  | ['skip', name: string]
  | Middleware<Input>

export type Pipeline<Input = unknown> = <Output = unknown>(
  modifications?: PipelineModifications[]
) => ChainHandler<Input, Output>

export const makePipeline = <Input>(links: Middleware[]): Pipeline<Input> => {
  const pipeline: Pipeline<Input> = (modifications = []) => {
    return async (mutableInput: Input) => {
      const input = freeze(mutableInput, true)

      const list = modify(links, modifications)

      const next: Next = async (input) => {
        const current = list.shift()

        if (current) {
          return await invoke(current, next, input)
        }

        return input
      }

      const head = list.shift()

      if (head) {
        return await invoke(head, next, input)
      }

      return input

      async function invoke(node, next, input) {
        if (typeof node === 'function') {
          return await node(next)(input)
        } else {
          return await node[1](next)(input)
        }
      }
    }
  }

  return pipeline
}

export const passAlong = (middleware: Middleware): Middleware => middleware

function modify(
  baseList: readonly Middleware[],
  modificationList: readonly PipelineModifications[]
): Middleware[] {
  const modifications = modificationList.slice(0)

  modifications.reverse()

  const base = baseList.slice(0)

  const initialLength = base.length

  for (const modification of modifications) {
    if (typeof modification === 'function') {
      base.splice(initialLength, 0, modification)
    } else {
      const [action, name, middleware] = modification

      const index = base.findIndex(
        (existing) => typeof existing !== 'function' && name === existing[0]
      )

      if (index < 0) {
        throw new Error(`could not find middleware named: "${name}"`)
      }

      if (action === 'replace') {
        base[index][1] = middleware
      } else if (action === 'skip') {
        base.splice(index, 1)
      } else {
        base.splice(action === 'before' ? index : index + 1, 0, middleware)
      }
    }
  }

  return base
}
