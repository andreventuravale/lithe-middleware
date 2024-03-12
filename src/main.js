import { randomUUID } from 'node:crypto'
import { createDraft, finishDraft, freeze, produce } from 'immer'

const ridKey = Symbol('rid')

const freezeUp = x => freeze(x, true)

const builder =
	(options = {}) =>
	(pipelineName, middlewares = []) => {
		const { parent, plugins = [], uuid = randomUUID } = options

		const prid = parent?.[ridKey]

		const pipeline = (modifications = []) => {
			const rid = uuid()

			const invoke = async (current, next, input) => {
				const iid = uuid()

				const name = nameOf(current)

				console.log(current, name)

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
						typeof current === 'function' ? current : current[1]

					const handler = middlewareFn(next)

					const output = freezeUp(await handler(input))

					const outputFromPlugins = freezeUp(
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

				let output = freezeUp(input)

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

function isNamed(item) {
	return (
		Array.isArray(item) &&
		item.length === 2 &&
		typeof item[0] === 'string' &&
		typeof item[1] === 'function'
	)
}

function isRelative(item) {
	return Array.isArray(item) && item.length === 3
}

function nameOf(item) {
	if (isNamed(item)) {
		return item[0]
	}

	if (isRelative(item)) {
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
		const aName = nameOf(a)
		const bName = nameOf(b)
		const aW = weightMap[aName]
		const bW = weightMap[bName]
		const aPos = requestLevelList.indexOf(a)
		const bPos = requestLevelList.indexOf(b)
		const x = aW === bW ? aPos : aW
		const y = aW === bW ? bPos : bW
		return y - x
	})

	const result = pipelineLevelList.slice(0)

	const initialLength = result.length

	for (const modification of modifications) {
		if (typeof modification === 'function' || isNamed(modification)) {
			result.splice(initialLength, 0, modification)
		} else if (isRelative(modification)) {
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

	const frozenEvent = freezeUp(event)

	for (const plugin of plugins) {
		await plugin.intercept?.(frozenEvent)
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
		const frozenEvent = freezeUp({ ...event, output })

		output =
			(await plugin.intercept?.(frozenEvent, {
				createDraft,
				finishDraft,
				produce,
			})) ?? output
	}

	return output
}
