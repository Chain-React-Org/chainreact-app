"use client"

import React, { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, CheckCircle, AlertCircle } from 'lucide-react'

export default function RequestIntegrationPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    integration: '',
    useCase: '',
    priority: 'medium',
    apiDocs: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false)
      setSubmitStatus('success')
      // Reset form after success
      setTimeout(() => {
        setFormData({
          name: '',
          email: '',
          company: '',
          integration: '',
          useCase: '',
          priority: 'medium',
          apiDocs: ''
        })
        setSubmitStatus('idle')
      }, 5000)
    }, 1500)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="relative z-40 px-4 sm:px-6 lg:px-8 py-6 bg-slate-900/50 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">Back to Home</span>
          </Link>
        </div>
      </nav>

      {/* Form Section */}
      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-500/10 border border-rose-500/20 mb-6">
              <Send className="w-4 h-4 text-rose-400" />
              <span className="text-sm font-semibold text-rose-300">Integration Request</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
              Request a New Integration
            </h1>
            <p className="text-lg text-gray-300">
              Don't see the integration you need? Let us know and we'll work on adding it.
            </p>
          </div>

          {submitStatus === 'success' ? (
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-8 text-center">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Request Submitted!</h2>
              <p className="text-gray-300">
                Thank you for your request. We'll review it and get back to you within 2-3 business days.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
              <div className="grid gap-6">
                {/* Name */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                    placeholder="John Doe"
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                    placeholder="john@company.com"
                  />
                </div>

                {/* Company */}
                <div>
                  <label htmlFor="company" className="block text-sm font-medium text-gray-300 mb-2">
                    Company
                  </label>
                  <input
                    type="text"
                    id="company"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                    placeholder="Acme Inc."
                  />
                </div>

                {/* Integration Name */}
                <div>
                  <label htmlFor="integration" className="block text-sm font-medium text-gray-300 mb-2">
                    Integration Name *
                  </label>
                  <input
                    type="text"
                    id="integration"
                    name="integration"
                    required
                    value={formData.integration}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                    placeholder="e.g., Salesforce, Monday.com, Zendesk"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="priority" className="block text-sm font-medium text-gray-300 mb-2">
                    Priority Level
                  </label>
                  <select
                    id="priority"
                    name="priority"
                    value={formData.priority}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                  >
                    <option value="low">Low - Nice to have</option>
                    <option value="medium">Medium - Would be helpful</option>
                    <option value="high">High - Critical for our workflow</option>
                  </select>
                </div>

                {/* Use Case */}
                <div>
                  <label htmlFor="useCase" className="block text-sm font-medium text-gray-300 mb-2">
                    Use Case Description *
                  </label>
                  <textarea
                    id="useCase"
                    name="useCase"
                    required
                    rows={4}
                    value={formData.useCase}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors resize-none"
                    placeholder="Describe how you would use this integration and what workflows you'd like to automate..."
                  />
                </div>

                {/* API Documentation */}
                <div>
                  <label htmlFor="apiDocs" className="block text-sm font-medium text-gray-300 mb-2">
                    API Documentation URL (if available)
                  </label>
                  <input
                    type="url"
                    id="apiDocs"
                    name="apiDocs"
                    value={formData.apiDocs}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                    placeholder="https://docs.example.com/api"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Providing API documentation helps us evaluate and implement the integration faster.
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full px-8 py-4 bg-gradient-to-r from-orange-600 to-rose-600 hover:from-orange-700 hover:to-rose-700 text-white font-semibold rounded-xl shadow-2xl shadow-rose-500/25 hover:shadow-rose-500/40 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Submit Request
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Info Box */}
          <div className="mt-8 bg-orange-500/10 border border-orange-500/20 rounded-xl p-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-white font-semibold mb-1">Enterprise Customers</h3>
                <p className="text-gray-300 text-sm">
                  Need a custom integration built specifically for your organization?
                  Contact our enterprise team at{' '}
                  <a href="mailto:enterprise@chainreact.ai" className="text-orange-400 hover:text-orange-300">
                    enterprise@chainreact.ai
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}