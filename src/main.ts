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
  baseList: Middleware[],
  modificationList: PipelineModifications[]
): Middleware[] {
  const modifications = modificationList
    .slice(0)
    .sort((a, b) => {
      const nameA = getName(typeof a === 'function' ? a : a[2])

      const nameB = getName(typeof b === 'function' ? b : b[2])

      const indexA = modificationList.indexOf(a)

      const indexB = modificationList.indexOf(b)

      const weightA = modificationList.filter((x) => x[1] === nameA).length

      const weightB = modificationList.filter((y) => y[1] === nameB).length

      const x = weightA + indexA

      const y = weightB + indexB

      console.log({
        nameA,
        nameB,
        indexA,
        indexB,
        weightA,
        weightB,
        x,
        y
      })

      return x - y
    })
    .reverse()

  console.log(
    modificationList.map((m) => getName(typeof m === 'function' ? m : m[2]))
  )

  console.log(
    modifications.map((m) => getName(typeof m === 'function' ? m : m[2]))
  )

  const base = baseList.slice(0)

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

function getName(middleware?: Middleware) {
  if (!middleware) {
    return
  }

  return typeof middleware === 'function' ? middleware.name : middleware[0]
}
