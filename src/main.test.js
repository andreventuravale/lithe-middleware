import { func, matchers, verify, when } from 'testdouble'
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
	const hello = ['hello', next => async input => await next(`hello ${input}`)]

	const b = ['b', next => async input => await next(`${input} b`)]

	const a = ['a', next => async input => await next(`${input}a`)]

	const r = ['r', next => async input => await next(`${input}r`)]

	const pipeline = builder()('test', [b, r])

	const request = pipeline([
		[hello, 'before', 'b'],
		[a, 'before', 'r'],
	])

	const reply = await request('foo')

	expect(reply).toEqual('hello foo bar')
})

test('Inserts a middleware adjacent to another.', async () => {
	const b = ['b', next => async input => await next(`${input} b`)]

	const a = ['a', next => async input => await next(`${input}a`)]

	const r = ['r', next => async input => await next(`${input}r`)]

	const baz = ['baz', next => async input => await next(`${input} baz`)]

	const pipeline = builder()('test', [b, r])

	const request = pipeline([
		[a, 'after', 'b'],
		[baz, 'after', 'r'],
	])

	const reply = await request('foo')

	expect(reply).toEqual('foo bar baz')
})

test('Replacing middlewares.', async () => {
	const foo = ['foo', next => async input => await next(`${input}foo`)]

	const bar = ['bar', next => async input => await next(`${input} bar`)]

	const pipeline = builder()('test', [foo, bar])

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
	const first = ['first', next => async input => await next(`${input}1`)]

	const second = ['second', next => async input => await next(`${input} 2`)]

	const third = ['third', next => async input => await next(`${input} 3`)]

	const pipeline = builder()('test', [first, second, third])

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

test('Generates an error if the referenced modification cannot be located ( skip case ).', async () => {
	const second = next => async input => await next(`${input} 2`)

	const third = next => async input => await next(`${input} 3`)

	const pipeline = builder()('test', [
		['second', second],
		['third', third],
	])

	expect(await pipeline()('')).toEqual(' 2 3')

	await expect(async () => {
		await pipeline([
			['skip', 'first'],
			['skip', 'second'],
		])('')
	}).rejects.toThrow('could not find middleware named: "first"')
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

test('(Plugins) Success events.', async () => {
	const intercept = func()

	const uuids = [
		'7f92590a-1baa-4954-9dc8-75a7b51574fd',
		'1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c',
		'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
		'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0',
	]

	const factory = builder({
		plugins: [
			{
				intercept: intercept,
			},
		],
		uuid: () => uuids.shift(),
	})

	const first = ['first', next => async input => await next(`${input}1`)]

	const second = ['second', next => async input => await next(`${input} 2`)]

	const third = ['third', next => async input => await next(`${input} 3`)]

	const pipeline = factory('test', [first, second, third])

	const request = pipeline()

	await request('')

	const tools = {
		createDraft: matchers.isA(Function),
		finishDraft: matchers.isA(Function),
		produce: matchers.isA(Function),
	}

	verify(
		intercept({
			type: 'request-begin',
			input: '',
			pipelineName: 'test',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: '1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c',
			input: '',
			name: 'first',
			pipelineName: 'test',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
			input: '1',
			name: 'second',
			pipelineName: 'test',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: 'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0',
			input: '1 2',
			name: 'third',
			pipelineName: 'test',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: 'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0',
				input: '1 2',
				name: 'third',
				output: '1 2 3',
				pipelineName: 'test',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
				input: '1',
				name: 'second',
				output: '1 2',
				pipelineName: 'test',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: '1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c',
				input: '',
				output: '1',
				name: 'first',
				pipelineName: 'test',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept(
			{
				type: 'request-end',
				input: '',
				output: '1 2 3',
				pipelineName: 'test',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)
})

test('(Plugins) Failures events.', async () => {
	const intercept = func()

	const first = ['foo', next => async input => await next(`${input}1`)]

	const second = ['bar', next => async input => await next(`${input} 2`)]

	const third = [
		'baz',
		() => async () => {
			throw new Error('error on third')
		},
	]

	const pipeline = builder({
		plugins: [
			{
				intercept,
			},
		],
	})('test', [first, second, third])

	const request = pipeline()

	await expect(async () => {
		await request('')
	}).rejects.toThrow('error on third')

	const tools = {
		createDraft: matchers.isA(Function),
		finishDraft: matchers.isA(Function),
		produce: matchers.isA(Function),
	}

	verify(
		intercept({
			type: 'request-begin',
			input: '',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
		}),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: matchers.isA(String),
			input: '',
			name: 'foo',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: matchers.isA(String),
				input: '',
				name: 'foo',
				output: '1',
				pipelineName: 'test',
				prid: undefined,
				rid: matchers.isA(String),
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: matchers.isA(String),
			input: '1',
			name: 'bar',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: matchers.isA(String),
				input: '1',
				name: 'bar',
				output: '1 2',
				pipelineName: 'test',
				prid: undefined,
				rid: matchers.isA(String),
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: matchers.isA(String),
			input: '1 2',
			name: 'baz',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
		}),
	)

	verify(
		intercept({
			type: 'invocation-end',
			error: matchers.argThat(({ message }) => message === 'error on third'),
			iid: matchers.isA(String),
			input: '1 2',
			name: 'baz',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
			status: 'failure',
		}),
	)

	verify(
		intercept({
			type: 'request-end',
			error: matchers.argThat(({ message }) => message === 'error on third'),
			input: '',
			pipelineName: 'test',
			prid: undefined,
			rid: matchers.isA(String),
			status: 'failure',
		}),
	)
})

test('Interdependency among the incoming modifications.', async () => {
	const pipeline = builder()('test', [])

	const a = ['a', next => async input => await next(`${input}a`)]

	const b = ['b', next => async input => await next(`${input}b`)]

	const c = ['c', next => async input => await next(`${input}c`)]

	const d = ['d', next => async input => await next(`${input}d`)]

	const e = ['e', next => async input => await next(`${input}e`)]

	const f = ['f', next => async input => await next(`${input}f`)]

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
				intercept: async (event, tools) => {
					if (event.type === 'invocation-end' && event.status === 'success') {
						const { name, output } = event

						const a = tools.produce(output, draft => {
							draft.traces ??= []
						})

						const b = tools.createDraft(a)

						b.traces.push(name)

						return tools.finishDraft(b)
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

test('Connects to another middleware.', async () => {
	const intercept = func()

	const uuids = [
		'7f92590a-1baa-4954-9dc8-75a7b51574fd', // rid 1
		'1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c', // iid 1
		'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1', // rid 2
		'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0', // iid 2
		'd220382e-5d7b-43fd-84ce-2a3916f24911', // connect
		'50b95581-99db-476f-9805-ccb58cfd466a', // iid 3
	]

	const options = {
		plugins: [
			{
				intercept,
			},
		],
		uuid: () => uuids.shift(),
	}

	const second = [
		'.2',
		next => async input => {
			const output = Object.assign({}, input, { bar: 'baz' })

			return await next(output)
		},
	]

	const pipeline2 = builder(options)('second', [second])

	const first = [
		'.1',
		next => async input => {
			const segment = pipeline2.connect(next)

			const request = segment()

			const response = await request(input)

			return response
		},
	]

	const third = [
		'.3',
		next => async input => {
			const output = Object.assign({}, input, { qux: 'waldo' })

			return await next(output)
		},
	]

	const pipeline1 = builder(options)('first', [first, third])

	const request = pipeline1()

	const response = await request({ foo: 'bar' })

	expect(response).toEqual({ foo: 'bar', bar: 'baz', qux: 'waldo' })

	const tools = {
		createDraft: matchers.isA(Function),
		finishDraft: matchers.isA(Function),
		produce: matchers.isA(Function),
	}

	verify(
		intercept({
			type: 'request-begin',
			input: { foo: 'bar' },
			pipelineName: 'first',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept(
			{
				type: 'request-end',
				input: { foo: 'bar' },
				output: { foo: 'bar', bar: 'baz', qux: 'waldo' },
				pipelineName: 'first',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'request-begin',
			input: { foo: 'bar' },
			pipelineName: 'second',
			prid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
			rid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
		}),
	)

	verify(
		intercept(
			{
				type: 'request-end',
				input: { foo: 'bar' },
				output: { foo: 'bar', bar: 'baz' },
				pipelineName: 'second',
				prid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				rid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: '1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c',
			input: { foo: 'bar' },
			name: '.1',
			pipelineName: 'first',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: '1f8bcb4e-12d9-4bf9-ad2f-42215f69d03c',
				input: { foo: 'bar' },
				name: '.1',
				output: { foo: 'bar', bar: 'baz' },
				pipelineName: 'first',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: 'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0',
			input: { foo: 'bar' },
			name: '.2',
			pipelineName: 'second',
			prid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
			rid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: 'e5f2da88-cd2c-4e9f-85ae-3169a8ac34f0',
				input: { foo: 'bar' },
				name: '.2',
				output: { foo: 'bar', bar: 'baz' },
				pipelineName: 'second',
				prid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				rid: 'e9480ca9-6a3f-4fb9-b07a-ed93ac9202d1',
				status: 'success',
			},
			tools,
		),
	)

	verify(
		intercept({
			type: 'invocation-begin',
			iid: '50b95581-99db-476f-9805-ccb58cfd466a',
			input: { foo: 'bar', bar: 'baz' },
			name: '.3',
			pipelineName: 'first',
			prid: undefined,
			rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
		}),
	)

	verify(
		intercept(
			{
				type: 'invocation-end',
				iid: '50b95581-99db-476f-9805-ccb58cfd466a',
				input: { foo: 'bar', bar: 'baz' },
				name: '.3',
				output: { foo: 'bar', bar: 'baz', qux: 'waldo' },
				pipelineName: 'first',
				prid: undefined,
				rid: '7f92590a-1baa-4954-9dc8-75a7b51574fd',
				status: 'success',
			},
			tools,
		),
	)
})

test('(Plugins) Forbids interceptors to directly change the output.', async () => {
	const foo = next => async input => await next(input)

	const request = builder({
		plugins: [
			{
				intercept({ type, output }) {
					if (type.endsWith('-end')) {
						output.foo = 'bar'
					}
				},
			},
		],
	})('test', [foo])()

	await expect(
		async () => await request({ foo: { bar: 'baz' } }),
	).rejects.toThrow(
		"Cannot assign to read only property 'foo' of object '#<Object>'",
	)
})

test('(Plugins) Forbids interceptors to directly change the output (deep).', async () => {
	const foo = next => async input => await next(input)

	const request = builder({
		plugins: [
			{
				intercept({ type, output }) {
					if (type.endsWith('-end')) {
						output.foo.bar.push('qux')
					}
				},
			},
		],
	})('test', [foo])()

	await expect(
		async () => await request({ foo: { bar: ['baz'] } }),
	).rejects.toThrow('Cannot add property 1, object is not extensible')
})

test('(Plugins) Forbids interceptors to directly change the input.', async () => {
	const foo = next => async input => await next(input)

	const request = builder({
		plugins: [
			{
				intercept({ input }) {
					input.foo = 'bar'
				},
			},
		],
	})('test', [foo])()

	await expect(
		async () => await request({ foo: { bar: 'baz' } }),
	).rejects.toThrow(
		"Cannot assign to read only property 'foo' of object '#<Object>'",
	)
})

test('(Plugins) Forbids interceptors to directly change the input (deep).', async () => {
	const foo = next => async input => await next(input)

	const request = builder({
		plugins: [
			{
				intercept({ input }) {
					input.foo.bar.push('qux')
				},
			},
		],
	})('test', [foo])()

	await expect(
		async () => await request({ foo: { bar: ['baz'] } }),
	).rejects.toThrow('Cannot add property 1, object is not extensible')
})
