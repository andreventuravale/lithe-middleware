import { func, matchers, verify } from 'testdouble'
import builder from './main.js'

test('Happy path.', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = next => async input => await next(`${input}a`)

	const r = next => async input => await next(`${input}r`)

	const pipeline = builder()('test', [b, a, r])

	const request = pipeline()

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')
})

test('Modifications on a initial empty middleware list.', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = next => async input => await next(`${input}a`)

	const r = next => async input => await next(`${input}r`)

	const pipeline = builder()('test', [])

	const request = pipeline([b, a, r])

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')
})

/**
 * This behavior is intentional. Errors do not propagate back through the middleware that has already been executed:
 *
 * After a middleware has been executed, it is permanently dismissed and not revisited.
 * There is no possibility of disguising an error with another error resulting from a previous middleware being unexpectedly affected.
 */
test('Propagates errors directly to the pipeline caller without rippling back through the preceding middlewares.', async () => {
	const bCatch = func()
	const aCatch = func()

	const b = next => async input => {
		try {
			return await next(`${input} b`)
		} catch (error) {
			bCatch(error)

			throw error
		}
	}

	const a = next => async input => {
		try {
			return await next(`${input}a`)
		} catch (error) {
			aCatch(error)

			throw error
		}
	}

	const r = () => async () => {
		throw new Error('rrrrrrrrrrrr')
	}

	const pipeline = builder()('test', [b, a, r])

	const request = pipeline()

	await expect(async () => {
		await request('foo')
	}).rejects.toThrow('rrrrrrrrrrrr')

	verify(bCatch(), { times: 0, ignoreExtraArgs: true })
	verify(aCatch(), { times: 0, ignoreExtraArgs: true })
})

test('An empty pipeline outputs the original input unchanged.', async () => {
	const pipeline = builder()('test')

	const request = pipeline()

	const reply = await request('foo')

	expect(reply).toEqual('foo')
})

test('Nested pipelines.', async () => {
	const a = next => async input => await next(`${input}a`)

	const b = next => async input => await next(`${input}b`)

	const c = next => async input => await next(`${input}c`)

	const bc = next => async input =>
		await next(await builder()('test', [b, c])()(input))

	const pipeline = builder()('test', [a, bc])

	const request = pipeline()

	const reply = await request('')

	expect(reply).toEqual('abc')
})

test('Named middlewares (tuple mode).', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = next => async output => await next(`${output}a`)

	const r = next => async output => await next(`${output}r`)

	const pipeline = builder()('test', [b, ['adds a', a], ['adds r', r]])

	const request = pipeline()

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')
})

test('Positions a middleware before another.', async () => {
	const hello = next => async input => await next(`hello ${input}`)

	const b = next => async input => await next(`${input} b`)

	function a(next) {
		return async input => await next(`${input}a`)
	}

	const r = next => async input => await next(`${input}r`)

	const pipeline = builder()('test', [b, ['r', r]])

	const request = pipeline([
		[hello, 'before', 'b'],
		[a, 'before', 'r'],
	])

	const reply = await request('foo')

	expect(reply).toEqual('hello foo bar')
})

test('Inserts a middleware adjacent to another.', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = next => async input => await next(`${input}a`)

	function r(next) {
		return async input => await next(`${input}r`)
	}

	const baz = next => async input => await next(`${input} baz`)

	const pipeline = builder()('test', [b, r])

	const request = pipeline([
		[a, 'after', 'b'],
		[baz, 'after', 'r'],
	])

	const reply = await request('foo')

	expect(reply).toEqual('foo bar baz')
})

test('Replacing middlewares.', async () => {
	const foo = next => async input => await next(`${input}foo`)

	function bar(next) {
		return async input => await next(`${input} bar`)
	}

	const pipeline = builder()('test', [
		['foo', foo],
		['bar', bar],
	])

	expect(await pipeline()('')).toEqual('foo bar')

	const qux = next => async input => await next(`${input}qux`)

	const waldo = next => async input => await next(`${input} waldo`)

	expect(
		await pipeline([
			[qux, 'replace', 'foo'],
			[waldo, 'replace', 'bar'],
		])(''),
	).toEqual('qux waldo')
})

test('Skipping middlewares.', async () => {
	function first(next) {
		return async input => await next(`${input}1`)
	}

	const second = next => async input => await next(`${input} 2`)

	const third = next => async input => await next(`${input} 3`)

	const pipeline = builder()('test', [
		['first', first],
		['second', second],
		['third', third],
	])

	expect(await pipeline()('')).toEqual('1 2 3')

	expect(
		await pipeline([
			['skip', 'first'],
			['skip', 'second'],
		])(''),
	).toEqual(' 3')
})

test('Appending middlewares.', async () => {
	const first = next => async input => await next(`${input}1`)

	const second = next => async input => await next(`${input} 2`)

	const third = next => async input => await next(`${input} 3`)

	const pipeline = builder()('test', [first, second, third])

	const d = next => async input => await next(`${input} 4`)

	const e = next => async input => await next(`${input} 5`)

	expect(await pipeline([d, e])('')).toEqual('1 2 3 4 5')
})

test('Generates an error if the referenced modification cannot be located.', async () => {
	const b = next => async input => await next(`${input} b`)

	const r = next => async input => await next(`${input}r`)

	const pipeline = builder()('test', [b, r])

	const a = next => async input => await next(`${input}a`)

	const request = pipeline([[a, 'before', 'foo bar']])

	await expect(async () => {
		await request('foo')
	}).rejects.toThrow('could not find middleware named: "foo bar"')
})

test('Modifications made at the request level, also known as request-level middlewares, do not influence the middleware list at the pipeline level.', async () => {
	const b = next => async input => await next(`${input} b`)

	const r = next => async input => await next(`${input}r`)

	const list = [b, ['adds r', r]]

	const pipeline = builder()('test', list)

	expect(list).toHaveLength(2)

	const a = next => async input => await next(`${input}a`)

	const request = pipeline([[a, 'before', 'adds r']])

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')

	expect(list).toHaveLength(2)
})

test('Not providing any middlewares at the request level does not impact the list of middlewares at the pipeline level.', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = next => async input => await next(`${input}a`)

	const r = next => async input => await next(`${input}r`)

	const list = [b, a, r]

	const factory = builder()('test', list)

	expect(list).toHaveLength(3)

	const request = factory()

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')

	expect(list).toHaveLength(3)
})

test('Request-level middlewares, also known as modifications, are executed within the scope of the pipeline-level process.', async () => {
	const first = next => async input => await next(`${input} b`)

	const list = [['first', first]]

	const pipeline = builder()('test', list)

	const a = next => async input => await next(`${input}a`)

	const r = next => async input => await next(`${input}r`)

	const request = pipeline([
		[a, 'after', 'first'],
		[r, 'after', 'first'],
	])

	const reply = await request('foo')

	expect(reply).toEqual('foo bar')
})

test('Request-level middlewares, also known as modifications, are incorporated and executed as part of the broader pipeline-level operations.', async () => {
	const first = next => async input => await next(`${input}1`)

	const second = next => async input => await next(`${input}2`)

	const third = next => async input => await next(`${input}3`)

	const forth = next => async input => await next(`${input}4`)

	const list = [
		['first', first],
		['second', second],
		['third', third],
		['forth', forth],
	]

	const pipeline = builder()('test', list)

	const a = next => async input => await next(`${input}a`)

	const d = next => async input => await next(`${input}d`)

	const c = next => async input => await next(`${input}c`)

	const b = next => async input => await next(`${input}b`)

	const request = pipeline([
		[a, 'after', 'first'],
		[d, 'after', 'forth'],
		[c, 'before', 'third'],
		[b, 'after', 'first'],
	])

	const reply = await request('')

	expect(reply).toEqual('1ab2c34d')
})

test('Forbids changes to the input.', async () => {
	const foo = next => async input => {
		input.foo = 'baz'

		return await next(input)
	}

	const factory = builder()

	const pipeline = factory('test', [foo])

	const request = pipeline()

	await expect(async () => await request({ foo: 'bar' })).rejects.toThrow(
		"Cannot assign to read only property 'foo' of object '#<Object>'",
	)
})

test('Forbids changes to the input (deep).', async () => {
	const foo = next => async input => {
		input.foo = 'foo'
		input.foo.bar = 'qux'

		return await next(input)
	}

	const request = builder()('test', [foo])()

	await expect(
		async () => await request({ foo: { bar: 'baz' } }),
	).rejects.toThrow(
		"Cannot assign to read only property 'foo' of object '#<Object>'",
	)
})

test('Forbids changes to the input (deep in arrays).', async () => {
	const fooBar = next => async input => {
		const entry = input.foo[1]

		entry.bar = 'qux'

		return await next(input)
	}

	const request = builder()('test', [fooBar])()

	await expect(
		async () =>
			await request({ foo: [0, { bar: 'baz' }] }).rejects.toThrow(
				`Cannot assign to read only property 'bar'`,
			),
	)
})

// test('(Plugins) Events.', async () => {
// 	const intercept = func<PipelineInterceptor>()

// 	const factory = builder({
// 		plugins: [
// 			{
// 				intercept: intercept,
// 			},
// 		],
// 	})

// 	const first = next => async input => await next(`${input}1`)

// 	function second(next) {
// 		return async input => await next(`${input} 2`)
// 	}

// 	const third = next => async input => await next(`${input} 3`)

// 	const pipeline = factory('test', [['first', first], second, ['third', third]])

// 	const request = pipeline()

// 	await request('')

// 	verify(
// 		intercept(
// 			{
// 				type: 'invocation-begin',
// 				input: '1 2',
// 				name: 'third',
// 				prid: matchers.anything(),
// 				pipelineName: 'test',
// 				rid: matchers.anything(),
// 				iid: matchers.anything(),
// 			},
// 			matchers.anything(),
// 		),
// 	)

// 	verify(
// 		intercept(
// 			{
// 				type: 'invocation-begin',
// 				input: '1',
// 				name: 'second',
// 				prid: matchers.anything(),
// 				pipelineName: 'test',
// 				rid: matchers.anything(),
// 				iid: matchers.anything(),
// 			},
// 			matchers.anything(),
// 		),
// 	)

// 	verify(
// 		intercept(
// 			{
// 				type: 'invocation-begin',
// 				input: '',
// 				name: 'first',
// 				rid: matchers.anything(),
// 				prid: matchers.anything(),
// 				pipelineName: 'test',
// 				iid: matchers.anything(),
// 			},
// 			matchers.anything(),
// 		),
// 	)

// 	t.pass('todo')

// 	// expect(
// 	//   explain(intercept).calls.map(({ args: [e] }) => [
// 	//     omit(e, ['prid', 'rid', 'iid'])
// 	//   ]),
// 	//   [
// 	//     [{ type: 'invocation-begin', input: '', name: 'first' }],
// 	//     [
// 	//       {
// 	//         type: 'end',
// 	//         input: '',
// 	//         output: '1',
// 	//         name: 'first',
// 	//         status: 'success'
// 	//       }
// 	//     ],
// 	//     [{ type: 'invocation-begin', input: '1', name: 'second' }],
// 	//     [
// 	//       {
// 	//         type: 'end',
// 	//         input: '1',
// 	//         output: '1 2',
// 	//         name: 'second',
// 	//         status: 'success'
// 	//       }
// 	//     ],
// 	//     [{ type: 'invocation-begin', input: '1 2', name: 'third' }],
// 	//     [
// 	//       {
// 	//         type: 'end',
// 	//         input: '1 2',
// 	//         output: '1 2 3',
// 	//         name: 'third',
// 	//         status: 'success'
// 	//       }
// 	//     ]
// 	//   ]
// 	// )
// })

// // test('(Plugins) Events with failures.', async (t) => {
// //   const intercept = func<PipelineInterceptor>()

// //   const first = (next) => async (input) => await next(input + '1')

// //   const second = (next) => async (input) => await next(input + ' 2')

// //   function third() {
// //     return async () => {
// //       throw new Error('error on third')
// //     }
// //   }

// //   const pipeline = builder({
// //     plugins: [
// //       {
// //         intercept
// //       }
// //     ]
// //   })('test', [['first', first], ['second', second], third])

// //   const request = pipeline()

// //   await t.throwsAsync(
// //     async () => {
// //       await request('')
// //     },
// //     { message: 'error on third' }
// //   )

// //   verify(
// //     intercept({ type: 'invocation-begin', input: '', name: 'first' }, matchers.anything())
// //   )
// //   verify(
// //     intercept({ type: 'invocation-begin', input: '1', name: 'second' }, matchers.anything())
// //   )
// //   verify(
// //     intercept({ type: 'invocation-begin', input: '1 2', name: 'third' }, matchers.anything())
// //   )

// //   verify(
// //     intercept(
// //       {
// //         type: 'end',
// //         input: '1 2',
// //         name: 'third',
// //         status: 'failure',
// //         error: new Error('error on third')
// //       },
// //       matchers.anything()
// //     )
// //   )
// // })

test('Interdependency among the incoming modifications.', async () => {
	const pipeline = builder()('test', [])

	function a(next) {
		return async input => await next(`${input}a`)
	}

	function b(next) {
		return async input => await next(`${input}b`)
	}

	function c(next) {
		return async input => await next(`${input}c`)
	}

	function d(next) {
		return async input => await next(`${input}d`)
	}

	function e(next) {
		return async input => await next(`${input}e`)
	}

	function f(next) {
		return async input => await next(`${input}f`)
	}

	expect(
		await pipeline([
			a,
			[b, 'before', 'a'],
			[c, 'before', 'b'],
			[d, 'before', 'c'],
			[e, 'before', 'd'],
			[f, 'before', 'e'],
		])(''),
	).toEqual('fedcba')

	expect(
		await pipeline([
			[f, 'before', 'e'],
			[e, 'before', 'd'],
			[d, 'before', 'c'],
			[c, 'before', 'b'],
			[b, 'before', 'a'],
			a,
		])(''),
	).toEqual('fedcba')

	expect(
		await pipeline([
			a,
			[b, 'after', 'a'],
			[c, 'after', 'b'],
			[d, 'after', 'c'],
			[e, 'after', 'd'],
			[f, 'after', 'e'],
		])(''),
	).toEqual('abcdef')

	expect(
		await pipeline([
			[f, 'after', 'e'],
			[e, 'after', 'd'],
			[d, 'after', 'c'],
			[c, 'after', 'b'],
			[b, 'after', 'a'],
			a,
		])(''),
	).toEqual('abcdef')
})

test('A middleware can stop the pipeline execution by not calling next.', async () => {
	const b = next => async input => await next(`${input} b`)

	const a = stop => next => async input =>
		stop ? `${input}a` : await next(`${input}a`)

	const r = next => async input => await next(`${input}r`)

	expect(await builder()('test', [b, a(false), r])()('foo')).toEqual('foo bar')

	expect(await builder()('test', [b, a(true), r])()('foo')).toEqual('foo ba')
})

test('(Plugins) Events can modify the output.', async () => {
	const first = next => async input =>
		await next(Object.assign({}, input, { foo: 'bar' }))

	const second = next => async input =>
		await next(Object.assign({}, input, { bar: 'baz' }))

	const pipeline = builder({
		plugins: [
			{
				intercept: async (event, { patch }) => {
					if (event.type === 'invocation-end' && event.status === 'success') {
						const { name, output } = event

						return patch(output, draft => {
							draft.traces ??= []

							draft.traces.push(name)
						})
					}
				},
			},
		],
	})('test', [
		['first', first],
		['second', second],
	])

	const request = pipeline()

	const response = await request({})

	expect(response).toEqual({
		foo: 'bar',
		bar: 'baz',
		traces: ['first', 'second'],
	})
})
