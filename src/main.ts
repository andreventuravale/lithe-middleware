import type {
  Middleware,
  Next,
  Pipeline,
  PipelineEvent,
  PipelineFactoryBuilder,
  PipelineModifications
} from './types.js'
import { freeze } from 'immer'

export * from './types.js'

const builder: PipelineFactoryBuilder =
  ({ plugins } = {}) =>
  (middlewares) => {
    const pipeline: Pipeline = (modifications = []) => {
      return async (mutableInput) => {
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

        function notify(info: Readonly<PipelineEvent>) {
          const frozen = freeze(info, true)

          plugins?.forEach((plugin) => {
            plugin.event?.(frozen)
          })
        }
      }
    }

    return pipeline
  }

export default builder

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
