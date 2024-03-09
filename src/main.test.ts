import builder, {
  type AnonymousMiddleware,
  type Middleware,
  type PipelineInterceptor
} from './main.js'
import test from 'ava'
import { func, matchers, verify } from 'testdouble'

test('Happy path.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()('test', [b, a, r])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Modifications on a initial empty middleware list.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()('test', [])

  const request = pipeline([b, a, r])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

/**
 * This behavior is intentional. Errors do not propagate back through the middleware that has already been executed:
 *
 * After a middleware has been executed, it is permanently dismissed and not revisited.
 * There is no possibility of disguising an error with another error resulting from a previous middleware being unexpectedly affected.
 */
test('Propagates errors directly to the pipeline caller without rippling back through the preceding middlewares.', async (t) => {
  const bCatch = func()
  const aCatch = func()

  const b = (next) => async (input) => {
    try {
      return await next(input + ' b')
    } catch (error) {
      bCatch(error)

      throw error
    }
  }

  const a = (next) => async (input) => {
    try {
      return await next(input + 'a')
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

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'rrrrrrrrrrrr' }
  )

  verify(bCatch(), { times: 0, ignoreExtraArgs: true })
  verify(aCatch(), { times: 0, ignoreExtraArgs: true })
})

test('An empty pipeline outputs the original input unchanged.', async (t) => {
  const pipeline = builder()('test')

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo')
})

test('Nested pipelines.', async (t) => {
  const a = (next) => async (input) => await next(input + 'a')

  const b = (next) => async (input) => await next(input + 'b')

  const c = (next) => async (input) => await next(input + 'c')

  const bc = (next) => async (input) =>
    await next(await builder()('test', [b, c])()(input))

  const pipeline = builder()('test', [a, bc])

  const request = pipeline()

  const reply = await request('')

  t.deepEqual(reply, 'abc')
})

test('Named middlewares (tuple mode).', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (output) => await next(output + 'a')

  const r = (next) => async (output) => await next(output + 'r')

  const pipeline = builder()('test', [b, ['adds a', a], ['adds r', r]])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Positions a middleware before another.', async (t) => {
  const hello = (next) => async (input) => await next('hello ' + input)

  const b = (next) => async (input) => await next(input + ' b')

  function a(next) {
    return async (input) => await next(input + 'a')
  }

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()('test', [b, ['r', r]])

  const request = pipeline([
    [hello, 'before', 'b'],
    [a, 'before', 'r']
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'hello foo bar')
})

test('Inserts a middleware adjacent to another.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  function r(next) {
    return async (input) => await next(input + 'r')
  }

  const baz = (next) => async (input) => await next(input + ' baz')

  const pipeline = builder()('test', [b, r])

  const request = pipeline([
    [a, 'after', 'b'],
    [baz, 'after', 'r']
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar baz')
})

test('Replacing middlewares.', async (t) => {
  const foo = (next) => async (input) => await next(input + 'foo')

  function bar(next) {
    return async (input) => await next(input + ' bar')
  }

  const pipeline = builder()('test', [
    ['foo', foo],
    ['bar', bar]
  ])

  t.deepEqual(await pipeline()(''), 'foo bar')

  const qux = (next) => async (input) => await next(input + 'qux')

  const waldo = (next) => async (input) => await next(input + ' waldo')

  t.deepEqual(
    await pipeline([
      [qux, 'replace', 'foo'],
      [waldo, 'replace', 'bar']
    ])(''),
    'qux waldo'
  )
})

test('Skipping middlewares.', async (t) => {
  function first(next) {
    return async (input) => await next(input + '1')
  }

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()('test', [
    ['first', first],
    ['second', second],
    ['third', third]
  ])

  t.deepEqual(await pipeline()(''), '1 2 3')

  t.deepEqual(
    await pipeline([
      ['skip', 'first'],
      ['skip', 'second']
    ])(''),
    ' 3'
  )
})

test('Appending middlewares.', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()('test', [first, second, third])

  const d = (next) => async (input) => await next(input + ' 4')

  const e = (next) => async (input) => await next(input + ' 5')

  t.deepEqual(await pipeline([d, e])(''), '1 2 3 4 5')
})

test('Generates an error if the referenced modification cannot be located.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()('test', [b, r])

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([[a, 'before', 'foo bar']])

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'could not find middleware named: "foo bar"' }
  )
})

test('Modifications made at the request level, also known as request-level middlewares, do not influence the middleware list at the pipeline level.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const list: Middleware[] = [b, ['adds r', r]]

  const pipeline = builder()('test', list)

  t.truthy(list.length === 2)

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([[a, 'before', 'adds r']])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.true(list.length === 2)
})

test('Not providing any middlewares at the request level does not impact the list of middlewares at the pipeline level.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const list: AnonymousMiddleware[] = [b, a, r]

  const factory = builder()('test', list)

  t.truthy(list.length === 3)

  const request = factory()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.truthy(list.length === 3)
})

test('Request-level middlewares, also known as modifications, are executed within the scope of the pipeline-level process.', async (t) => {
  const first = (next) => async (input) => await next(input + ' b')

  const list: Middleware[] = [['first', first]]

  const pipeline = builder()('test', list)

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const request = pipeline([
    [a, 'after', 'first'],
    [r, 'after', 'first']
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Request-level middlewares, also known as modifications, are incorporated and executed as part of the broader pipeline-level operations.', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + '2')

  const third = (next) => async (input) => await next(input + '3')

  const forth = (next) => async (input) => await next(input + '4')

  const list: Middleware[] = [
    ['first', first],
    ['second', second],
    ['third', third],
    ['forth', forth]
  ]

  const pipeline = builder()('test', list)

  const a = (next) => async (input) => await next(input + 'a')

  const d = (next) => async (input) => await next(input + 'd')

  const c = (next) => async (input) => await next(input + 'c')

  const b = (next) => async (input) => await next(input + 'b')

  const request = pipeline([
    [a, 'after', 'first'],
    [d, 'after', 'forth'],
    [c, 'before', 'third'],
    [b, 'after', 'first']
  ])

  const reply = await request('')

  t.deepEqual(reply, '1ab2c34d')
})

test('Forbids changes to the input.', async (t) => {
  type Foo = { foo: string }

  const foo = (next) => async (input: Foo) => {
    input.foo = 'baz'

    return await next(input)
  }

  const factory = builder()

  const pipeline = factory('test', [foo])

  const request = pipeline()

  await t.throwsAsync(async () => await request({ foo: 'bar' }), {
    message: /Cannot assign to read only property 'foo'/
  })
})

test('Forbids changes to the input (deep).', async (t) => {
  const foo = (next) => async (input: { foo: { bar: string } }) => {
    input.foo.bar = 'qux'

    return await next(input)
  }

  const request = builder()('test', [foo])()

  await t.throwsAsync(async () => await request({ foo: { bar: 'baz' } }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('Forbids changes to the input (deep in arrays).', async (t) => {
  const fooBar = (next) => async (input: { foo: Array<{ bar: string }> }) => {
    const entry = input.foo[1]

    entry.bar = 'qux'

    return await next(input)
  }

  const request = builder()('test', [fooBar])()

  await t.throwsAsync(async () => await request({ foo: [0, { bar: 'baz' }] }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('In a typeless pipeline, you can specify the output type at the request level using generics, without encountering any issues from the type checker.', async (t) => {
  const typelessFactory = builder()

  const typelessMiddleware = (next) => async (input) => await next(input)

  const typelessPipeline = typelessFactory('test', [typelessMiddleware])

  const typelessRequest = typelessPipeline()

  const reply = await typelessRequest<{ foo: { bar: string } }>({ foo: 'bar' })

  t.deepEqual(reply.foo, 'bar')
})

test('(Plugins) Events.', async (t) => {
  const intercept = func<PipelineInterceptor>()

  const factory = builder({
    plugins: [
      {
        intercept: intercept
      }
    ]
  })

  const first = (next) => async (input) => await next(input + '1')

  function second(next) {
    return async (input) => await next(input + ' 2')
  }

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = factory('test', [['first', first], second, ['third', third]])

  const request = pipeline()

  await request('')

  verify(
    intercept(
      {
        type: 'invocation-begin',
        input: '1 2',
        name: 'third',
        pid: matchers.anything(),
        pipelineName: 'test',
        rid: matchers.anything(),
        iid: matchers.anything()
      },
      matchers.anything()
    )
  )

  verify(
    intercept(
      {
        type: 'invocation-begin',
        input: '1',
        name: 'second',
        pid: matchers.anything(),
        pipelineName: 'test',
        rid: matchers.anything(),
        iid: matchers.anything()
      },
      matchers.anything()
    )
  )

  verify(
    intercept(
      {
        type: 'invocation-begin',
        input: '',
        name: 'first',
        rid: matchers.anything(),
        pid: matchers.anything(),
        pipelineName: 'test',
        iid: matchers.anything()
      },
      matchers.anything()
    )
  )

  t.pass('todo')

  // t.deepEqual(
  //   explain(intercept).calls.map(({ args: [e] }) => [
  //     omit(e, ['pid', 'rid', 'iid'])
  //   ]),
  //   [
  //     [{ type: 'invocation-begin', input: '', name: 'first' }],
  //     [
  //       {
  //         type: 'end',
  //         input: '',
  //         output: '1',
  //         name: 'first',
  //         status: 'success'
  //       }
  //     ],
  //     [{ type: 'invocation-begin', input: '1', name: 'second' }],
  //     [
  //       {
  //         type: 'end',
  //         input: '1',
  //         output: '1 2',
  //         name: 'second',
  //         status: 'success'
  //       }
  //     ],
  //     [{ type: 'invocation-begin', input: '1 2', name: 'third' }],
  //     [
  //       {
  //         type: 'end',
  //         input: '1 2',
  //         output: '1 2 3',
  //         name: 'third',
  //         status: 'success'
  //       }
  //     ]
  //   ]
  // )
})

// test('(Plugins) Events with failures.', async (t) => {
//   const intercept = func<PipelineInterceptor>()

//   const first = (next) => async (input) => await next(input + '1')

//   const second = (next) => async (input) => await next(input + ' 2')

//   function third() {
//     return async () => {
//       throw new Error('error on third')
//     }
//   }

//   const pipeline = builder({
//     plugins: [
//       {
//         intercept
//       }
//     ]
//   })('test', [['first', first], ['second', second], third])

//   const request = pipeline()

//   await t.throwsAsync(
//     async () => {
//       await request('')
//     },
//     { message: 'error on third' }
//   )

//   verify(
//     intercept({ type: 'invocation-begin', input: '', name: 'first' }, matchers.anything())
//   )
//   verify(
//     intercept({ type: 'invocation-begin', input: '1', name: 'second' }, matchers.anything())
//   )
//   verify(
//     intercept({ type: 'invocation-begin', input: '1 2', name: 'third' }, matchers.anything())
//   )

//   verify(
//     intercept(
//       {
//         type: 'end',
//         input: '1 2',
//         name: 'third',
//         status: 'failure',
//         error: new Error('error on third')
//       },
//       matchers.anything()
//     )
//   )
// })

test('Interdependency among the incoming modifications.', async (t) => {
  const pipeline = builder()('test', [])

  function a(next) {
    return async (input) => await next(input + 'a')
  }

  function b(next) {
    return async (input) => await next(input + 'b')
  }

  function c(next) {
    return async (input) => await next(input + 'c')
  }

  function d(next) {
    return async (input) => await next(input + 'd')
  }

  function e(next) {
    return async (input) => await next(input + 'e')
  }

  function f(next) {
    return async (input) => await next(input + 'f')
  }

  t.deepEqual(
    await pipeline([
      a,
      [b, 'before', 'a'],
      [c, 'before', 'b'],
      [d, 'before', 'c'],
      [e, 'before', 'd'],
      [f, 'before', 'e']
    ])(''),
    'fedcba'
  )

  t.deepEqual(
    await pipeline([
      [f, 'before', 'e'],
      [e, 'before', 'd'],
      [d, 'before', 'c'],
      [c, 'before', 'b'],
      [b, 'before', 'a'],
      a
    ])(''),
    'fedcba'
  )

  t.deepEqual(
    await pipeline([
      a,
      [b, 'after', 'a'],
      [c, 'after', 'b'],
      [d, 'after', 'c'],
      [e, 'after', 'd'],
      [f, 'after', 'e']
    ])(''),
    'abcdef'
  )

  t.deepEqual(
    await pipeline([
      [f, 'after', 'e'],
      [e, 'after', 'd'],
      [d, 'after', 'c'],
      [c, 'after', 'b'],
      [b, 'after', 'a'],
      a
    ])(''),
    'abcdef'
  )
})

test('A middleware can stop the pipeline execution by not calling next.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (stop) => (next) => async (input) =>
    stop ? input + 'a' : await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  t.deepEqual(await builder()('test', [b, a(false), r])()('foo'), 'foo bar')

  t.deepEqual(await builder()('test', [b, a(true), r])()('foo'), 'foo ba')
})

test('(Plugins) Events can modify the output.', async (t) => {
  const first = (next) => async (input) =>
    await next(Object.assign({}, input, { foo: 'bar' }))

  const second = (next) => async (input) =>
    await next(Object.assign({}, input, { bar: 'baz' }))

  const pipeline = builder({
    plugins: [
      {
        intercept: async (event, { patch }) => {
          if (event.type === 'invocation-end' && event.status === 'success') {
            const { name, output } = event

            return patch(output, (draft: any) => {
              draft.traces ??= []

              draft.traces.push(name)
            })
          }
        }
      }
    ]
  })('test', [
    ['first', first],
    ['second', second]
  ])

  const request = pipeline()

  const response = await request({})

  t.deepEqual(response, { foo: 'bar', bar: 'baz', traces: ['first', 'second'] })
})
