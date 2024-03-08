import type {
  Middleware,
  Next,
  Pipeline,
  PipelineEvent,
  PipelineFactoryBuilder,
  PipelineModification
} from './types.js'
import { freeze } from 'immer'

export * from './types.js'

const builder: PipelineFactoryBuilder =
  ({ plugins } = {}) =>
  (middlewares) => {
    const notify = (info: Readonly<PipelineEvent>) => {
      const frozen = freeze(info, true)

      plugins?.forEach((plugin) => {
        plugin.event?.(frozen)
      })
    }

    const invoke = async (middleware, next, input) => {
      const name = getName(middleware)

      try {
        await notify({ type: 'begin', input, name })

        if (typeof middleware === 'function') {
          await middleware(next)(input)
        } else {
          await middleware[1](next)(input)
        }

        await notify({
          type: 'end',
          input,
          name,
          status: 'success'
        })
      } catch (error) {
        await notify({
          type: 'end',
          input,
          name,
          status: 'failure',
          error
        })

        throw error
      }
    }

    const pipeline: Pipeline =
      (modifications = []) =>
      async <Output>(input) => {
        const sequence = modify(middlewares, modifications)

        if (sequence.length === 0) return input

        let output = freeze(input, true)

        let middleware = sequence.shift()

        const next: Next = async (patch) => {
          output = patch

          middleware = sequence.shift()

          return output
        }

        while (middleware) {
          await invoke(middleware, next, output)
        }

        return output as Output
      }

    return pipeline
  }

export default builder

function modify(
  pipelineLevelList: Middleware[],
  requestLevelList: PipelineModification[]
): Middleware[] {
  const weightMap = {}

  for (const modification of requestLevelList) {
    const type = modification[0]

    const name = getName(modification)

    switch (type) {
      case 'before':
      case 'after':
      case 'skip':
      case 'replace':
        {
          const ref = modification[1]

          weightMap[ref] ??= 0

          weightMap[ref] += (weightMap[name] ?? 0) + 1
        }
        break

      default:
        weightMap[name] ??= 0
    }
  }

  const modifications = requestLevelList.slice(0).sort((a, b) => {
    const nameA = getName(a)

    const nameB = getName(b)

    return (weightMap[nameB] ?? 0) - (weightMap[nameA] ?? 0)
  })

  console.log(weightMap)

  console.log(requestLevelList.map(getName))

  console.log(modifications.map(getName))

  const base = pipelineLevelList.slice(0)

  const initialLength = base.length

  for (const modification of modifications) {
    if (typeof modification === 'function') {
      base.splice(initialLength, 0, modification)
    } else {
      const [action, name, middleware] = modification

      const index = base.findIndex((existing) => getName(existing) === name)

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

function getName(item?: Middleware | PipelineModification) {
  if (typeof item === 'function') {
    return item.name
  }

  if (
    Array.isArray(item) &&
    item.length === 2 &&
    typeof item[0] === 'string' &&
    typeof item[1] === 'function'
  ) {
    return item[0]
  }

  if (Array.isArray(item) && item.length === 3) {
    return getName(item[2])
  }

  return undefined
}
