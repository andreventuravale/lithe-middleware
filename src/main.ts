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

export type PipelineEventType = 'begin' | 'end'

export type PipelineBaseEvent<Input, Type extends PipelineEventType> = {
  type: Type
  name: string | undefined
  input: Input
}

export type PipelineBeginEvent<Input> = PipelineBaseEvent<Input, 'begin'>

export type PipelineEndEvent<Input> = PipelineBaseEvent<Input, 'end'> & {
  status: 'success' | 'failure'
  error?: Error
}

export type PipelineEvent<Input> =
  | PipelineBeginEvent<Input>
  | PipelineEndEvent<Input>

export type PipelineEventHandler<Input> = (
  event: Readonly<PipelineEvent<Input>>
) => Promise<void>

export type PipelinePlugin<Input> = { event?: PipelineEventHandler<Input> }

export type PipelineOptions<Input> = {
  plugins?: PipelinePlugin<Input>[]
}

const makePipeline = <Input>(
  middlewares: Middleware[],
  { plugins }: PipelineOptions<Input> = {}
): Pipeline<Input> => {
  const pipeline: Pipeline<Input> = (modifications = []) => {
    return async (mutableInput: Input) => {
      const input = freeze(mutableInput, true)

      const list = modify(middlewares, modifications)

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
        let error

        try {
          await notify({
            type: 'begin',
            input,
            name: node[0]
          })

          if (typeof node === 'function') {
            return await node(next)(input)
          } else {
            return await node[1](next)(input)
          }
        } catch (e) {
          error = e

          throw e
        } finally {
          await notify({
            type: 'end',
            input,
            name: node[0],
            status: error ? 'failure' : 'success',
            error
          })
        }
      }

      function notify(info: Readonly<PipelineEvent<Input>>) {
        const frozen = freeze(info, true)

        plugins?.forEach((plugin) => {
          plugin.event?.(frozen)
        })
      }
    }
  }

  return pipeline
}

export default makePipeline
