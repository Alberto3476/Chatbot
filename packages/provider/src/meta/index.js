const { ProviderClass } = require('@bot-whatsapp/bot')
const axios = require('axios')
const MetaWebHookServer = require('./server')
const URL = `https://graph.facebook.com/v15.0`

/**
 * ⚙️MetaProvider: Es un provedor que te ofrece enviar
 * mensaje a Whatsapp via API
 * info: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 *
 * Necesitas las siguientes tokens y valores
 * { token, numberId, vendorNumber, verify_token }
 */

class MetaProvider extends ProviderClass {
    metHook
    token
    numberId
    constructor({ token, numberId, verifyToken }, _port = 3000) {
        super()
        this.token = token
        this.numberId = numberId
        this.metHook = new MetaWebHookServer(verifyToken, _port)
        this.metHook.start()

        const listEvents = this.busEvents()

        for (const { event, func } of listEvents) {
            this.metHook.on(event, func)
        }
    }

    /**
     * Mapeamos los eventos nativos de  whatsapp-web.js a los que la clase Provider espera
     * para tener un standar de eventos
     * @returns
     */
    busEvents = () => [
        {
            event: 'auth_failure',
            func: (payload) => this.emit('error', payload),
        },
        {
            event: 'ready',
            func: () => this.emit('ready', true),
        },
        {
            event: 'message',
            func: (payload) => {
                this.emit('message', payload)
            },
        },
    ]

    async sendMessageMeta(body) {
        try {
            const response = await axios.post(
                `${URL}/${this.numberId}/messages`,
                body,
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                    },
                }
            )
            return response.data
        } catch (error) {
            return Promise.resolve(error)
        }
    }

    async sendtext(number, message) {
        const body = {
            messaging_product: 'whatsapp',
            to: number,
            type: 'text',
            text: {
                preview_url: false,
                body: message,
            },
        }
        await this.sendMessageMeta(body)
    }

    async sendMedia(number, message, mediaInput = null) {
        if (!mediaInput) throw new Error(`MEDIA_INPUT_NULL_: ${mediaInput}`)
        const body = {
            messaging_product: 'whatsapp',
            to: number,
            type: 'image',
            image: {
                link: mediaInput,
            },
        }
        await this.sendMessageMeta(body)
    }

    /**
     *
     * @param {*} userId
     * @param {*} message
     * @param {*} param2
     * @returns
     */
    sendMessage = async (number, message, { options }) => {
        if (options?.buttons?.length) return console.log('Envio de botones')
        if (options?.media)
            return this.sendMedia(number, message, options.media)

        this.sendtext(number, message)
    }
}

module.exports = MetaProvider
