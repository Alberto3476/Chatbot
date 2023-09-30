const { suite } = require('uvu')
const assert = require('uvu/assert')
const { addKeyword, createBot, createFlow, EVENTS } = require('../packages/bot/index')
const { setup, clear, delay } = require('../__mocks__/env')

const suiteCase = suite('Flujo: idle state')

suiteCase.before.each(setup)
suiteCase.after.each(clear)

suiteCase(`Prevenir enviar mensaje luego de inactividad (2seg)`, async ({ database, provider }) => {
    const flujoFinal = addKeyword(EVENTS.ACTION).addAnswer('Se cancelo por inactividad')

    const flujoPrincipal = addKeyword(['hola'])
        .addAnswer(
            'debes de responder antes de que transcurran 2 segundos (2000)',
            { capture: true, idle: 2000 },
            async (ctx, { gotoFlow, inRef }) => {
                if (ctx?.idleFallBack) {
                    return gotoFlow(flujoFinal)
                }
            }
        )
        .addAnswer('gracias!')

    await createBot({
        database,
        flow: createFlow([flujoPrincipal, flujoFinal]),
        provider,
    })

    await provider.delaySendMessage(0, 'message', {
        from: '000',
        body: 'hola',
    })

    await provider.delaySendMessage(50, 'message', {
        from: '000',
        body: 'mensaje al segundo',
    })

    await delay(3000)
    const getHistory = database.listHistory.map((i) => i.answer)
    assert.is('debes de responder antes de que transcurran 2 segundos (2000)', getHistory[0])
    assert.is('mensaje al segundo', getHistory[1])
    assert.is('gracias!', getHistory[2])
    assert.is(undefined, getHistory[3])
})

suiteCase(`Enviar mensaje luego de inactividad (2seg)`, async ({ database, provider }) => {
    const flujoFinal = addKeyword(EVENTS.ACTION).addAnswer('Se cancelo por inactividad')

    const flujoPrincipal = addKeyword(['hola'])
        .addAnswer(
            'debes de responder antes de que transcurran 2 segundos (2000)',
            { idle: 2000, capture: true },
            async (ctx, { gotoFlow }) => {
                if (ctx?.idleFallBack) {
                    return gotoFlow(flujoFinal)
                }
            }
        )
        .addAnswer('gracias!')

    await createBot({
        database,
        flow: createFlow([flujoPrincipal, flujoFinal]),
        provider,
    })

    await provider.delaySendMessage(0, 'message', {
        from: '000',
        body: 'hola',
    })

    await delay(3000)
    const getHistory = database.listHistory.map((i) => i.answer)
    assert.is('debes de responder antes de que transcurran 2 segundos (2000)', getHistory[0])
    assert.is('Se cancelo por inactividad', getHistory[1])
    assert.is(undefined, getHistory[2])
})

suiteCase(`Enviar mensajes con ambos casos de idle`, async ({ database, provider }) => {
    const flujoFinal = addKeyword(EVENTS.ACTION)
        .addAnswer('Se cancelo por inactividad')
        .addAction(async (_, { flowDynamic }) => {
            await flowDynamic(`Empezemos de nuevo.`)
            await flowDynamic(`Cual es el numero de orden? tienes dos segundos para responder...`)
        })
        .addAction({ capture: true, idle: 2000 }, async (ctx, { flowDynamic }) => {
            if (ctx?.idleFallBack) {
                return flowDynamic(`BYE!`)
            }
            await flowDynamic(`Ok el numero que escribiste es ${ctx.body}`)
        })
        .addAnswer('gracias!')

    const flujoPrincipal = addKeyword(['hola']).addAnswer(
        'Hola tienes 2 segundos para responder si no te pedire de nuevo otro dato',
        { idle: 2000, capture: true },
        async (ctx, { gotoFlow }) => {
            if (ctx?.idleFallBack) {
                return gotoFlow(flujoFinal)
            }
        }
    )

    await createBot({
        database,
        flow: createFlow([flujoPrincipal, flujoFinal]),
        provider,
    })

    await provider.delaySendMessage(0, 'message', {
        from: '000',
        body: 'hola',
    })

    await delay(2100)
    await provider.delaySendMessage(0, 'message', {
        from: '000',
        body: 'el numero es 444',
    })

    await delay(10000)

    const getHistory = database.listHistory.map((i) => i.answer)
    assert.is('Hola tienes 2 segundos para responder si no te pedire de nuevo otro dato', getHistory[0])
    assert.is('Se cancelo por inactividad', getHistory[1])
    assert.is('__call_action__', getHistory[2])
    assert.is('Empezemos de nuevo.', getHistory[3])
    assert.is('Cual es el numero de orden? tienes dos segundos para responder...', getHistory[4])
    assert.is('__capture_only_intended__', getHistory[5])
    assert.is('el numero es 444', getHistory[6])
    assert.is('Ok el numero que escribiste es el numero es 444', getHistory[7])
    assert.is('gracias!', getHistory[8])
    assert.is(undefined, getHistory[9])
})

suiteCase.run()
