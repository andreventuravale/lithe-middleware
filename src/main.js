import { randomUUID } from 'node:crypto'
import { freeze, produce } from 'immer'

const ridKey = Symbol('rid')

const builder =
	(options = {}) =>
	(pipelineName, middlewares = []) => {
		const { parent, plugins = [] } = options

		const prid = parent?.[ridKey]

		const pipeline = (modifications = []) => {
			const rid = randomUUID()

			const invoke = async (middleware, next, input) => {
				const iid = randomUUID()

				const name = nameOf(middleware)

				try {
					await notifyWithoutOutput(plugins, {
						type: 'invocation-begin',
						iid,
						input,
						name,
						pipelineName,
						prid,
						rid,
					})

					const middlewareFn =
						typeof middleware === 'function' ? middleware : middleware[1]

					const handler = middlewareFn(next)

					const output = freeze(await handler(input), true)

					const outputFromPlugins = freeze(
						await notifyWithOutput(plugins, {
							type: 'invocation-end',
							iid,
							input,
							name,
							output,
							pipelineName,
							prid,
							rid,
							status: 'success',
						}),
						true,
					)

					return outputFromPlugins ?? output
				} catch (error) {
					await notifyWithoutOutput(plugins, {
						type: 'invocation-end',
						error,
						iid,
						input,
						name,
						pipelineName,
						prid,
						rid,
						status: 'failure',
					})

					throw error
				}
			}

			return async input => {
				await notifyWithoutOutput(plugins, {
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

					next[ridKey] = rid

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
						await notifyWithoutOutput(plugins, {
							type: 'request-end',
							error: requestError,
							input,
							pipelineName,
							prid,
							rid,
							status: 'failure',
						})
					} else {
						await notifyWithOutput(plugins, {
							type: 'request-end',
							input,
							output,
							pipelineName,
							prid,
							rid,
							status: 'success',
						})
					}
				}
			}
		}

		pipeline.connect = next =>
			builder({ ...options, parent: next })(pipelineName, [
				...middlewares,
				() => next,
			])

		return pipeline
	}

export default builder

function nameOf(item) {
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
		return nameOf(item[0])
	}
}

function modify(pipelineLevelList, requestLevelList) {
	const graph = {}

	const weightMap = {}

	const weightOf = x =>
		x in graph
			? graph[x].reduce((sum, ref) => sum + weightOf(ref), graph[x].length)
			: 0

	for (const modification of requestLevelList) {
		const type = modification[1]

		const name = nameOf(modification)

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
		const name = nameOf(modification)

		weightMap[name] = weightOf(name)
	}

	const modifications = requestLevelList.slice(0).sort((a, b) => {
		const nameA = nameOf(a)
		const nameB = nameOf(b)
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

			const index = result.findIndex(existing => nameOf(existing) === ref)

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

			const index = result.findIndex(existing => nameOf(existing) === name)

			if (index < 0) {
				throw new Error(`could not find middleware named: "${name}"`)
			}

			result.splice(index, 1)
		}
	}

	return result
}

const notifyWithoutOutput = async (plugins, event) => {
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

const notifyWithOutput = async (plugins, event) => {
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
			(await plugin.intercept?.(frozenEvent, { patch: produce })) ?? output
	}

	return output
}
