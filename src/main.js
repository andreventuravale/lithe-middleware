import { randomUUID } from 'node:crypto'
import { freeze, produce } from 'immer'

const RID_KEY = Symbol('rid')

const builder =
	(options = {}) =>
	(pipelineName, middlewares = []) => {
		const { plugins = [], parent } = options

		const prid = parent?.[RID_KEY]

		const pipeline = (modifications = []) => {
			const rid = randomUUID()

			const notifyWithOutput = async event => {
				switch (event.type) {
					case 'invocation-end':
						if (!event.name) {
							return
						}
				}

				let output = event.output

				for (const plugin of plugins) {
					const frozenEvent = freeze({ ...event, output }, true)

					output =
						(await plugin.intercept?.(frozenEvent, { patch: produce })) ??
						output
				}

				return output
			}

			const notifyWithoutOutput = async event => {
				switch (event.type) {
					case 'invocation-begin':
					case 'invocation-end':
						if (!event.name) {
							return
						}
				}

				const frozenEvent = freeze(event, true)

				for (const plugin of plugins) {
					await plugin.intercept?.(frozenEvent, { patch: produce })
				}
			}

			const invoke = async (middleware, next, input) => {
				const iid = randomUUID()

				const name = getName(middleware)

				try {
					await notifyWithoutOutput({
						type: 'invocation-begin',
						input,
						name,
						pipelineName,
						prid,
						rid,
						iid,
					})

					const middlewareFn =
						typeof middleware === 'function' ? middleware : middleware[1]

					const handler = middlewareFn(next)

					const output = freeze(await handler(input), true)

					const outputFromPlugins = freeze(
						await notifyWithOutput({
							type: 'invocation-end',
							input,
							output,
							name,
							status: 'success',
							pipelineName,
							prid,
							rid,
							iid,
						}),
						true,
					)

					return outputFromPlugins ?? output
				} catch (error) {
					console.log(21312312312, { error })

					await notifyWithoutOutput({
						type: 'invocation-end',
						input,
						name,
						status: 'failure',
						error,
						pipelineName,
						prid,
						rid,
						iid,
					})

					throw error
				}
			}

			return async input => {
				await notifyWithoutOutput({
					type: 'request-begin',
					input,
					pipelineName,
					prid,
					rid,
				})

				let output = freeze(input, true)

				let requestError

				try {
					const sequence = modify(middlewares, modifications)

					if (sequence.length === 0) return input

					let middleware = sequence.shift()

					const next = async patch => {
						middleware = sequence.shift()

						return patch
					}

					next[RID_KEY] = rid

					while (middleware) {
						const current = middleware

						middleware = undefined

						output = await invoke(current, next, output)
					}

					return output
				} catch (error) {
					requestError = error

					throw error
				} finally {
					if (requestError) {
						await notifyWithoutOutput({
							type: 'request-end',
							input,
							status: 'failure',
							error: requestError,
							pipelineName,
							prid,
							rid,
						})
					} else {
						await notifyWithOutput({
							type: 'request-end',
							input,
							output,
							status: 'success',
							pipelineName,
							prid,
							rid,
						})
					}
				}
			}
		}

		pipeline.connect = next => {
			return builder({ ...options, parent: next })(pipelineName, [
				...middlewares,
				() => next,
			])
		}

		return pipeline
	}

export default builder

function modify(pipelineLevelList, requestLevelList) {
	const graph = {}

	const weightMap = {}

	const weightOf = x =>
		x in graph
			? graph[x].reduce((sum, ref) => sum + weightOf(ref), graph[x].length)
			: 0

	for (const modification of requestLevelList) {
		const type = modification[1]

		const name = getName(modification)

		switch (type) {
			case 'before':
			case 'after':
			case 'skip':
			case 'replace':
				{
					const ref = modification[2]

					graph[ref] ??= []

					graph[ref].push(name)

					graph[ref] = graph[ref].concat(graph[name] ?? [])
				}
				break
		}
	}

	for (const modification of requestLevelList) {
		const name = getName(modification)

		weightMap[name] = weightOf(name)
	}

	const modifications = requestLevelList.slice(0).sort((a, b) => {
		const nameA = getName(a)
		const nameB = getName(b)
		const x = weightMap[nameA]
		const y = weightMap[nameB]
		const i = requestLevelList.indexOf(a)
		const j = requestLevelList.indexOf(b)
		const k = x === y ? i : x
		const l = x === y ? j : y
		return l - k
	})

	const result = pipelineLevelList.slice(0)

	const initialLength = result.length

	for (const modification of modifications) {
		if (typeof modification === 'function') {
			result.splice(initialLength, 0, modification)
		} else if (modification.length === 3) {
			const [middleware, action, ref] = modification

			const index = result.findIndex(existing => getName(existing) === ref)

			if (index < 0) {
				throw new Error(`could not find middleware named: "${ref}"`)
			}

			if (action === 'replace') {
				result[index][1] = middleware
			} else {
				result.splice(action === 'before' ? index : index + 1, 0, middleware)
			}
		} else {
			const [, name] = modification

			const index = result.findIndex(existing => getName(existing) === name)

			if (index < 0) {
				throw new Error(`could not find middleware named: "${name}"`)
			}

			result.splice(index, 1)
		}
	}

	return result
}

function getName(item) {
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
		return getName(item[0])
	}
}
